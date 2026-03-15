import modal
import os
import json
import subprocess
import pathlib

# ---------------------------------------------------------------------------
# Modal App & Image
# ---------------------------------------------------------------------------
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.12"
    )
    .apt_install(["ffmpeg", "libgl1-mesa-glx", "wget"])
    .pip_install(
        "boto3",
        "fastapi[standard]",
        "pydantic",
        "google-generativeai",
        "requests",
        "pysubs2",
        "numpy",
        "rembg[gpu]",
        "Pillow",
        "edge-tts",
    )
    .pip_install(
        "torch",
        "torchaudio",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .run_commands(["pip install git+https://github.com/m-bain/whisperx.git"])
    .run_commands(
        [
            "mkdir -p /usr/share/fonts/truetype/custom",
            "wget -O /usr/share/fonts/truetype/custom/Anton-Regular.ttf "
            "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf",
            "wget -O /usr/share/fonts/truetype/custom/Montserrat-Bold.ttf "
            "https://github.com/google/fonts/raw/main/static/Montserrat-Bold.ttf",
            "fc-cache -f -v",
        ]
    )
)

app = modal.App("glibran-backend", image=image)

volume = modal.Volume.from_name("glibran-model-cache", create_if_missing=True)


# ---------------------------------------------------------------------------
# Heavy GPU Worker – runs the full clipper pipeline in a single container
# ---------------------------------------------------------------------------
@app.cls(
    gpu="A10G",
    secrets=[modal.Secret.from_dotenv()],
    timeout=3600,
    volumes={"/root/.cache": volume},
)
class ClipperWorker:
    """Loads AI models once via @modal.enter(), then processes videos."""

    @modal.enter()
    def load_models(self):
        import whisperx
        import torch
        import google.generativeai as genai
        import boto3

        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device

        print("Loading WhisperX model…")
        self.whisperx_model = whisperx.load_model(
            "large-v2", device, compute_type="float16"
        )
        self.alignment_model, self.metadata = whisperx.load_align_model(
            language_code="en", device=device
        )
        print("WhisperX loaded.")

        print("Creating Gemini client…")
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        self.gemini_model = genai.GenerativeModel("gemini-2.5-flash")
        print("Gemini client ready.")

        self.s3 = boto3.client(
            "s3",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        self.bucket = os.environ.get(
            "AWS_S3_BUCKET_NAME", "glibran-storage-bucket"
        )

    # -- internal helpers (not exposed as Modal methods) --------------------

    def _transcribe(self, audio_path: str):
        """Run WhisperX transcription + alignment, return word-level & segment-level results."""
        import whisperx

        audio = whisperx.load_audio(audio_path)
        result = self.whisperx_model.transcribe(audio, batch_size=16)
        result = whisperx.align(
            result["segments"],
            self.alignment_model,
            self.metadata,
            audio,
            self.device,
            return_char_alignments=False,
        )
        word_segments = []
        for seg in result["segments"]:
            for w in seg.get("words", []):
                word_segments.append(w)
        return word_segments, result["segments"]

    def _identify_moments(self, segments: list) -> list:
        """Ask Gemini 2.5 Flash to pick the most viral moments."""
        full_text = ""
        for seg in segments:
            s = seg.get("start", 0)
            e = seg.get("end", 0)
            t = seg.get("text", "").strip()
            full_text += f"[{s:.2f} - {e:.2f}] {t}\n"

        prompt = (
            "You are an expert short-form video editor for TikTok/YouTube Shorts.\n"
            "Analyze this transcript and find the 1-3 most engaging viral moments "
            "suitable for short clips (15-60 seconds each).\n"
            "Look for: compelling stories, surprising facts, funny moments, "
            "controversial opinions, or emotional peaks.\n"
            "Return ONLY a valid JSON array. No markdown code blocks.\n"
            'Format: [{"start_time": 10.5, "end_time": 45.2, '
            '"title": "Clip title", "viral_score": 85}]\n\n'
            f"Transcript:\n{full_text}"
        )

        response = self.gemini_model.generate_content(prompt)
        cleaned = response.text.strip()
        # Strip markdown fences if present
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()

        return json.loads(cleaned)

    def _create_subtitles(
        self,
        word_segments: list,
        clip_start: float,
        clip_end: float,
        output_path: str,
        max_words: int = 5,
    ):
        """Build an ASS subtitle file from word-level timestamps."""
        import pysubs2

        clip_words = [
            w
            for w in word_segments
            if w.get("start") is not None
            and w.get("end") is not None
            and w["end"] > clip_start
            and w["start"] < clip_end
        ]

        groups: list[tuple[float, float, str]] = []
        buf: list[str] = []
        buf_s = buf_e = 0.0

        for w in clip_words:
            txt = w.get("word", "").strip()
            if not txt:
                continue
            s_rel = max(0.0, w["start"] - clip_start)
            e_rel = max(0.0, w["end"] - clip_start)
            if not buf:
                buf_s, buf_e, buf = s_rel, e_rel, [txt]
            elif len(buf) >= max_words:
                groups.append((buf_s, buf_e, " ".join(buf)))
                buf_s, buf_e, buf = s_rel, e_rel, [txt]
            else:
                buf.append(txt)
                buf_e = e_rel
        if buf:
            groups.append((buf_s, buf_e, " ".join(buf)))

        subs = pysubs2.SSAFile()
        subs.info["PlayResX"] = 1080
        subs.info["PlayResY"] = 1920
        subs.info["ScaledBorderAndShadow"] = "yes"
        subs.info["ScriptType"] = "v4.00+"

        style = pysubs2.SSAStyle()
        style.fontname = "Anton"
        style.fontsize = 80
        style.primarycolor = pysubs2.Color(255, 255, 255)
        style.outlinecolor = pysubs2.Color(0, 0, 0)
        style.outline = 3.0
        style.shadow = 2.0
        style.alignment = 2
        style.marginv = 150
        style.marginl = 50
        style.marginr = 50
        style.bold = True
        subs.styles["Default"] = style

        for s, e, txt in groups:
            subs.events.append(
                pysubs2.SSAEvent(
                    start=pysubs2.make_time(s=s),
                    end=pysubs2.make_time(s=e),
                    text=txt.upper(),
                    style="Default",
                )
            )
        subs.save(output_path)

    def _notify_frontend(self, job_id: str, status: str, clips: list, error: str | None = None):
        """POST the result back to the Next.js webhook endpoint."""
        import requests

        base = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
        payload: dict = {"job_id": job_id, "status": status, "clips": clips}
        if error:
            payload["error"] = error
        try:
            requests.post(f"{base}/api/webhooks/modal", json=payload, timeout=15)
            print(f"[{job_id}] Webhook sent ({status})")
        except Exception as e:
            print(f"[{job_id}] Webhook failed: {e}")

    # -- main pipeline (exposed as a Modal method) --------------------------

    @modal.method()
    def process_video(self, job_id: str, video_s3_key: str):
        base = pathlib.Path(f"/tmp/{job_id}")
        base.mkdir(parents=True, exist_ok=True)
        video_path = str(base / "raw.mp4")
        audio_path = str(base / "audio.wav")

        print(f"[{job_id}] Pipeline starting")

        try:
            # 1. Download from S3
            print(f"[{job_id}] Downloading video…")
            self.s3.download_file(self.bucket, video_s3_key, video_path)

            # 2. Extract audio (WAV 16 kHz mono for WhisperX)
            print(f"[{job_id}] Extracting audio…")
            subprocess.run(
                f"ffmpeg -y -i {video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}",
                shell=True,
                check=True,
                capture_output=True,
            )

            # 3. Transcribe with WhisperX
            print(f"[{job_id}] Transcribing…")
            word_segs, full_segs = self._transcribe(audio_path)
            print(f"[{job_id}] Got {len(word_segs)} words")

            # 4. Find viral moments via Gemini
            print(f"[{job_id}] Analysing with Gemini…")
            moments = self._identify_moments(full_segs)
            print(f"[{job_id}] Found {len(moments)} moments")

            # 5. Process each clip
            clips_out: list[dict] = []
            for i, m in enumerate(moments):
                st = m.get("start_time")
                et = m.get("end_time")
                if st is None or et is None:
                    continue

                cdir = base / f"clip_{i}"
                cdir.mkdir(exist_ok=True)
                seg_path = str(cdir / "seg.mp4")
                vert_path = str(cdir / "vert.mp4")
                sub_path = str(cdir / "subs.ass")
                final_path = str(cdir / "final.mp4")

                dur = et - st

                # 5a. Cut segment
                subprocess.run(
                    f"ffmpeg -y -ss {st} -t {dur} -i {video_path} -c copy {seg_path}",
                    shell=True,
                    check=True,
                    capture_output=True,
                )

                # 5b. Vertical crop (9:16) with blurred background fill
                vf = (
                    "split[original][blur];"
                    "[blur]scale=1080:1920:force_original_aspect_ratio=increase,"
                    "crop=1080:1920,boxblur=20:5[bg];"
                    "[original]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
                    "[bg][fg]overlay=(W-w)/2:(H-h)/2"
                )
                subprocess.run(
                    f'ffmpeg -y -i {seg_path} -filter_complex "{vf}" '
                    f"-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k {vert_path}",
                    shell=True,
                    check=True,
                    capture_output=True,
                )

                # 5c. Burn subtitles
                self._create_subtitles(word_segs, st, et, sub_path)
                subprocess.run(
                    f'ffmpeg -y -i {vert_path} -vf "ass={sub_path}" '
                    f"-c:v h264 -preset fast -crf 23 -c:a copy {final_path}",
                    shell=True,
                    check=True,
                    capture_output=True,
                )

                # 5d. Upload to S3
                clip_s3_key = f"processed/{job_id}/clip_{i}.mp4"
                self.s3.upload_file(
                    final_path,
                    self.bucket,
                    clip_s3_key,
                    ExtraArgs={"ContentType": "video/mp4"},
                )
                clip_url = f"https://{self.bucket}.s3.amazonaws.com/{clip_s3_key}"
                clips_out.append(
                    {
                        "clip_url": clip_url,
                        "s3_key": clip_s3_key,
                        "title": m.get("title", f"Clip {i}"),
                        "viral_score": m.get("viral_score", 0),
                    }
                )
                print(f"[{job_id}] Clip {i} done")

            # 6. Notify frontend
            self._notify_frontend(job_id, "COMPLETED", clips_out)
            print(f"[{job_id}] Pipeline complete!")
            return clips_out

        except Exception as e:
            print(f"[{job_id}] FAILED: {e}")
            self._notify_frontend(job_id, "FAILED", [], str(e))
            raise


# ---------------------------------------------------------------------------
# Thumbnail Worker – background removal + template overlay
# ---------------------------------------------------------------------------
@app.cls(
    gpu="A10G",
    secrets=[modal.Secret.from_dotenv()],
    timeout=600,
)
class ThumbnailWorker:
    @modal.enter()
    def setup(self):
        import boto3
        self.s3 = boto3.client(
            "s3",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        self.bucket = os.environ.get("AWS_S3_BUCKET_NAME", "glibran-storage-bucket")

    def _notify(self, job_id, status, result_url=None, error=None):
        import requests
        base = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
        payload = {
            "job_id": job_id,
            "status": status,
            "clips": [{"clip_url": result_url, "title": "Thumbnail"}] if result_url else [],
        }
        if error:
            payload["error"] = error
        try:
            requests.post(f"{base}/api/webhooks/modal", json=payload, timeout=15)
        except Exception as e:
            print(f"[{job_id}] Webhook failed: {e}")

    @modal.method()
    def generate_thumbnail(self, job_id: str, image_s3_key: str, headline: str = "YOUR TEXT HERE"):
        from PIL import Image, ImageDraw, ImageFont
        from rembg import remove
        import io

        base = pathlib.Path(f"/tmp/{job_id}")
        base.mkdir(parents=True, exist_ok=True)
        img_path = str(base / "input.png")
        out_path = str(base / "thumbnail.png")

        print(f"[{job_id}] Thumbnail pipeline starting")
        try:
            # 1. Download image from S3
            self.s3.download_file(self.bucket, image_s3_key, img_path)

            # 2. Open image and create thumbnail canvas (1280x720)
            original = Image.open(img_path).convert("RGBA")
            canvas_w, canvas_h = 1280, 720

            # 3. Resize original to fill canvas
            scale = max(canvas_w / original.width, canvas_h / original.height)
            resized = original.resize(
                (int(original.width * scale), int(original.height * scale)),
                Image.LANCZOS,
            )
            bg = resized.crop((
                (resized.width - canvas_w) // 2,
                (resized.height - canvas_h) // 2,
                (resized.width + canvas_w) // 2,
                (resized.height + canvas_h) // 2,
            ))

            # 4. Remove background from original to get subject
            input_bytes = io.BytesIO()
            original.save(input_bytes, format="PNG")
            subject_bytes = remove(input_bytes.getvalue())
            subject = Image.open(io.BytesIO(subject_bytes)).convert("RGBA")
            subject = subject.resize(
                (int(subject.width * scale), int(subject.height * scale)),
                Image.LANCZOS,
            )
            subject = subject.crop((
                (subject.width - canvas_w) // 2,
                (subject.height - canvas_h) // 2,
                (subject.width + canvas_w) // 2,
                (subject.height + canvas_h) // 2,
            ))

            # 5. Draw headline text on the background (behind subject)
            draw = ImageDraw.Draw(bg)
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/custom/Montserrat-Bold.ttf", 72)
            except Exception:
                font = ImageFont.load_default()

            text_upper = headline.upper()
            bbox = draw.textbbox((0, 0), text_upper, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            tx = (canvas_w - tw) // 2
            ty = (canvas_h - th) // 2

            # Text shadow
            draw.text((tx + 3, ty + 3), text_upper, fill=(0, 0, 0, 200), font=font)
            # White text
            draw.text((tx, ty), text_upper, fill=(255, 255, 255, 255), font=font)

            # 6. Composite subject on top (text-behind-person effect)
            bg.paste(subject, (0, 0), subject)

            # 7. Save and upload
            final = bg.convert("RGB")
            final.save(out_path, "PNG", quality=95)

            s3_key = f"thumbnails/{job_id}/thumbnail.png"
            self.s3.upload_file(out_path, self.bucket, s3_key, ExtraArgs={"ContentType": "image/png"})
            url = f"https://{self.bucket}.s3.amazonaws.com/{s3_key}"

            self._notify(job_id, "COMPLETED", url)
            print(f"[{job_id}] Thumbnail done: {url}")
            return url

        except Exception as e:
            print(f"[{job_id}] Thumbnail FAILED: {e}")
            self._notify(job_id, "FAILED", error=str(e))
            raise


# ---------------------------------------------------------------------------
# Avatar Worker – TTS + portrait-to-video (simplified MVP)
# ---------------------------------------------------------------------------
@app.cls(
    gpu="A10G",
    secrets=[modal.Secret.from_dotenv()],
    timeout=900,
)
class AvatarWorker:
    @modal.enter()
    def setup(self):
        import boto3
        self.s3 = boto3.client(
            "s3",
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )
        self.bucket = os.environ.get("AWS_S3_BUCKET_NAME", "glibran-storage-bucket")

    def _notify(self, job_id, status, result_url=None, error=None):
        import requests
        base = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
        payload = {
            "job_id": job_id,
            "status": status,
            "clips": [{"clip_url": result_url, "title": "Avatar Video"}] if result_url else [],
        }
        if error:
            payload["error"] = error
        try:
            requests.post(f"{base}/api/webhooks/modal", json=payload, timeout=15)
        except Exception as e:
            print(f"[{job_id}] Webhook failed: {e}")

    @modal.method()
    def generate_avatar(self, job_id: str, photo_s3_key: str, script_text: str):
        """
        MVP Avatar: Generate TTS audio from script, then create a video
        with the photo and synced audio using FFmpeg.
        Future: integrate hallo3 for full lip-sync portrait animation.
        """
        import asyncio
        import edge_tts

        base = pathlib.Path(f"/tmp/{job_id}")
        base.mkdir(parents=True, exist_ok=True)
        photo_path = str(base / "photo.png")
        audio_path = str(base / "speech.mp3")
        video_path = str(base / "avatar.mp4")

        print(f"[{job_id}] Avatar pipeline starting")
        try:
            # 1. Download photo
            self.s3.download_file(self.bucket, photo_s3_key, photo_path)

            # 2. Generate TTS audio with edge-tts
            print(f"[{job_id}] Generating TTS…")
            async def _tts():
                communicate = edge_tts.Communicate(script_text, "en-US-GuyNeural")
                await communicate.save(audio_path)
            asyncio.run(_tts())

            # 3. Create video: photo + audio → MP4 with zoom/pan effect
            # Probe audio duration
            probe = subprocess.run(
                f'ffprobe -v error -show_entries format=duration -of json {audio_path}',
                shell=True, capture_output=True, text=True,
            )
            duration = float(json.loads(probe.stdout)["format"]["duration"])

            # Ken Burns zoom effect on the photo + audio overlay
            vf = (
                "scale=1080:1920:force_original_aspect_ratio=increase,"
                "crop=1080:1920,"
                f"zoompan=z='min(zoom+0.0005,1.15)':d={int(duration*25)}:s=1080x1920:fps=25"
            )
            subprocess.run(
                f'ffmpeg -y -loop 1 -i {photo_path} -i {audio_path} '
                f'-filter_complex "[0:v]{vf}[v]" -map "[v]" -map 1:a '
                f'-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k '
                f'-t {duration} -shortest {video_path}',
                shell=True, check=True, capture_output=True,
            )

            # 4. Upload to S3
            s3_key = f"avatars/{job_id}/avatar.mp4"
            self.s3.upload_file(video_path, self.bucket, s3_key, ExtraArgs={"ContentType": "video/mp4"})
            url = f"https://{self.bucket}.s3.amazonaws.com/{s3_key}"

            self._notify(job_id, "COMPLETED", url)
            print(f"[{job_id}] Avatar done: {url}")
            return url

        except Exception as e:
            print(f"[{job_id}] Avatar FAILED: {e}")
            self._notify(job_id, "FAILED", error=str(e))
            raise


# ---------------------------------------------------------------------------
# FastAPI entrypoint – lightweight, no GPU
# ---------------------------------------------------------------------------
from pydantic import BaseModel


class ProcessVideoRequest(BaseModel):
    job_id: str
    video_s3_key: str


class GenerateThumbnailRequest(BaseModel):
    job_id: str
    image_s3_key: str
    headline: str = "YOUR TEXT HERE"


class GenerateAvatarRequest(BaseModel):
    job_id: str
    photo_s3_key: str
    script_text: str


@app.function(secrets=[modal.Secret.from_dotenv()])
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI

    api = FastAPI(title="Glibran Backend")

    @api.get("/health")
    async def health():
        return {"status": "ok"}

    @api.post("/process-video")
    async def process_video(req: ProcessVideoRequest):
        ClipperWorker().process_video.spawn(req.job_id, req.video_s3_key)
        return {"status": "processing", "job_id": req.job_id}

    @api.post("/generate-thumbnail")
    async def generate_thumbnail(req: GenerateThumbnailRequest):
        ThumbnailWorker().generate_thumbnail.spawn(req.job_id, req.image_s3_key, req.headline)
        return {"status": "processing", "job_id": req.job_id}

    @api.post("/generate-avatar")
    async def generate_avatar(req: GenerateAvatarRequest):
        AvatarWorker().generate_avatar.spawn(req.job_id, req.photo_s3_key, req.script_text)
        return {"status": "processing", "job_id": req.job_id}

    return api
