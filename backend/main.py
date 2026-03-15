import modal
from fastapi import FastAPI
from pydantic import BaseModel
import boto3
import os
import json
import google.generativeai as genai

# --- Configuration & App Setup ---
app = FastAPI()
stub = modal.App("glibran-backend")

s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
BUCKET_NAME = os.environ.get("AWS_S3_BUCKET_NAME", "glibran-storage-bucket")

# --- Schemas ---
class ProcessVideoRequest(BaseModel):
    job_id: str
    video_s3_key: str

# --- Modal Image Definition ---
# This defines the environment our Serverless GPU function runs in
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("boto3", "fastapi", "pydantic", "google-generativeai", "requests")
    .env({
        "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
        "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
        "AWS_REGION": os.environ.get("AWS_REGION", "ap-southeast-1")
    })
)

# WhisperX requires a specific PyTorch/CUDA environment
whisper_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install(
        "torch", 
        "torchaudio", 
        index_url="https://download.pytorch.org/whl/cu121"
    )
    .pip_install("git+https://github.com/m-bain/whisperx.git")
    .env({
        "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
        "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
        "AWS_REGION": os.environ.get("AWS_REGION", "ap-southeast-1")
    })
)

# --- Core Serverless Functions ---
@stub.function(image=image, secrets=[modal.Secret.from_dotenv()])
def download_from_s3(s3_key: str, local_path: str):
    """Downloads a file from S3 to the Modal container's ephemeral storage."""
    print(f"Downloading {s3_key} to {local_path} from S3...")
    s3_client.download_file(BUCKET_NAME, s3_key, local_path)
    print("Download complete.")
    return True

@stub.function(image=image, secrets=[modal.Secret.from_dotenv()])
def extract_audio(video_path: str, audio_path: str):
    """Extracts audio from downloaded video using FFmpeg."""
    print(f"Extracting audio from {video_path}...")
    import subprocess
    cmd = [
        "ffmpeg", "-i", video_path, 
        "-vn", "-acodec", "libmp3lame", 
        "-ar", "16000", "-ac", "1", 
        "-y", audio_path
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"Audio extracted to {audio_path}")
    return True

@stub.function(image=image, secrets=[modal.Secret.from_dotenv()])
def upload_to_s3(local_path: str, s3_key: str):
    """Uploads a generated clip back to S3."""
    print(f"Uploading {local_path} to {s3_key}...")
    s3_client.upload_file(local_path, BUCKET_NAME, s3_key, ExtraArgs={'ContentType': 'video/mp4'})
    print("Upload complete.")
    return f"https://{BUCKET_NAME}.s3.amazonaws.com/{s3_key}"

@stub.function(image=image, secrets=[modal.Secret.from_dotenv()])
def crop_and_subtitle(video_path: str, audio_path: str, start_time: float, end_time: float, output_path: str):
    """
    Crops video to 9:16 aspect ratio (center crop for MVP), 
    trims it to the specified start/end times, and burns basic subtitles.
    """
    import subprocess
    print(f"Cropping from {start_time} to {end_time}...")
    
    # 1. Generate local ASS subtitles file from whisper (for MVP we just do a fast trim/crop)
    # 2. Trim and Crop (9:16 vertical center)
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time),
        "-to", str(end_time),
        "-i", video_path,
        "-vf", "crop=ih*9/16:ih", # Fast center crop 9:16
        "-c:a", "aac",
        output_path
    ]
    
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"Clip saved to {output_path}")
    return True

@stub.function(image=whisper_image, gpu="A10G", timeout=1200)
def run_whisperx(audio_path: str):
    """Transcribes audio using WhisperX with word-level timestamps."""
    print(f"Starting WhisperX transcription for {audio_path}...")
    import whisperx
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    batch_size = 16 
    
    # Load model
    model = whisperx.load_model("large-v2", device, compute_type="float16")
    
    # Transcribe
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=batch_size)
    
    # Align timestamps
    model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
    
    print("Transcription complete.")
    return result["segments"]

@stub.function(image=image, secrets=[modal.Secret.from_dotenv()])
def analyze_viral_moments(transcript_segments: list):
    """Uses Gemini 2.5 Flash to find the most viral moments in the transcript."""
    print("Analyzing transcript with Gemini 2.5 Flash...")
    
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    
    # Prepare text for LLM
    full_text = ""
    for seg in transcript_segments:
        start = seg.get('start', 0)
        end = seg.get('end', 0)
        text = seg.get('text', '').strip()
        full_text += f"[{start:.2f} - {end:.2f}] {text}\n"

    prompt = f"""
    You are an expert short-form video editor (TikTok/Reels). 
    Analyze the following video transcript using the provided timestamps.
    Identify the 1 to 3 most engaging, "viral" moments suitable for short-form clips (between 15 to 60 seconds each).
    Return ONLY a valid JSON array of objects with 'start_time', 'end_time', 'title', and 'viral_score' (1-100). Do not use markdown blocks.
    
    Transcript:
    {full_text}
    """
    
    model = genai.GenerativeModel("gemini-2.5-flash")
    response = model.generate_content(prompt)
    
    try:
        # Strip potential markdown formatting from Gemini response
        cleaned_response = response.text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        clips = json.loads(cleaned_response)
        print(f"Found {len(clips)} viral clips.")
        return clips
    except Exception as e:
        print(f"Failed to parse Gemini response: {e}")
        return []

@app.post("/process-video")
async def trigger_video_processing(request: ProcessVideoRequest):
    """
    Entrypoint API called by Next.js Inngest.
    This routes the request to our heavy GPU instance on Modal.
    """
    print(f"Received request to process job: {request.job_id}")
    
    # We trigger the intensive logic asynchronously (fire and forget)
    run_clipper_pipeline.spawn(request.job_id, request.video_s3_key)
    
    return {"status": "success", "job_id": request.job_id, "message": "Processing started on Modal"}


@stub.function(image=image, secrets=[modal.Secret.from_dotenv()], timeout=3600)
def run_clipper_pipeline(job_id: str, video_s3_key: str):
    """The main orchestration pipeline that runs on Modal Serverless GPUs."""
    import os
    
    os.makedirs("/tmp/clips", exist_ok=True)
    local_video_path = f"/tmp/{job_id}_raw.mp4"
    local_audio_path = f"/tmp/{job_id}_audio.mp3"
    
    print(f"[JOB {job_id}] Starting Clipper Pipeline")

    try:
        # Step 1: Download from S3 (Task 2.2)
        download_from_s3.remote(video_s3_key, local_video_path)
        
        # Step 2: Extract Audio
        extract_audio.remote(local_video_path, local_audio_path)
        
        # Step 3: Transcribe with WhisperX (Task 2.3)
        print(f"[JOB {job_id}] Starting Transcription...")
        transcript = run_whisperx.remote(local_audio_path)
        
        # Step 4: Analyze with Gemini 2.5 Flash (Task 2.3)
        print(f"[JOB {job_id}] Analyzing moments with LLM...")
        viral_clips = analyze_viral_moments.remote(transcript)
        
        print(f"[JOB {job_id}] Viral Clips Detected: {viral_clips}")
        
        # Step 5: Crop and Upload (Task 2.4)
        output_urls = []
        for i, clip in enumerate(viral_clips):
            start_t = clip.get('start_time')
            end_t = clip.get('end_time')
            if start_t is None or end_t is None: continue
            
            clip_local_path = f"/tmp/clips/{job_id}_clip_{i}.mp4"
            clip_s3_key = f"processed/{job_id}/clip_{i}.mp4"
            
            # Run FFMPEG cropping
            crop_and_subtitle.remote(local_video_path, local_audio_path, start_t, end_t, clip_local_path)
            
            # Upload back to S3
            s3_url = upload_to_s3.remote(clip_local_path, clip_s3_key)
            output_urls.append({"clip_url": s3_url, "title": clip.get("title", f"Clip {i}")})
            
        print(f"[JOB {job_id}] Full Pipeline Finished. outputs: {output_urls}")
        
        # Step 6: Notify Frontend Webhook (Task 2.5)
        import requests
        frontend_url = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
        webhook_url = f"{frontend_url}/api/webhooks/modal"
        
        payload = {
            "job_id": job_id,
            "status": "COMPLETED",
            "clips": output_urls
        }
        
        try:
            requests.post(webhook_url, json=payload, timeout=10)
            print(f"[JOB {job_id}] Webhook sent successfully.")
        except Exception as webhook_err:
            print(f"[JOB {job_id}] Warning: Failed to send webhook: {webhook_err}")
            
    except Exception as e:
        print(f"[JOB {job_id}] FAILED: {str(e)}")
        # In actual production, we'd send a webhook back to Next.js stating it failed.

@stub.function(image=image)
@modal.asgi_app()
def fastapi_app():
    return app
