# Glibran Heavy-Compute Backend

This directory encompasses the heavy-weight CPU/GPU inference logic that runs our computer vision models like WhisperX and handles heavy rendering with FFMpeg pipelines.

---

## Tech Stack Details

*   **FastAPI**: Pure REST endpoints orchestration routes correctly setup.
*   **Modal**: Deployment pipeline triggers running Serverless Python mesh containers.
*   **WhisperX**: Generates timestamped transcription node nodes.
*   **Gemini 2.5 Flash**: Orchestrates NLP hooks correctly.

## Getting Started

To run the back API pipeline triggers locally:

```bash
# activate virtualization
source venv/bin/activate

# run standard uvicorn debug endpoints
uvicorn main:app --port 8000
```

*Note: Deployment will require `modal deploy main.py` triggers to Modal cloud mesh once properly deployed.*

---

## Key Back Endpoints index
-   `main.py` - FastAPI entry mesh pipelines mappings endpoints handlers layouts.
-   `requirements.txt` - Python backend modules dependency layouts setups.

---
*Back to dashboard root index file [../README.md](../README.md).*
