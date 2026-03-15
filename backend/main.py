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
# FastAPI entrypoint – lightweight, no GPU
# ---------------------------------------------------------------------------
from pydantic import BaseModel


class ProcessVideoRequest(BaseModel):
    job_id: str
    video_s3_key: str


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

    return api
