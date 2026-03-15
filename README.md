# Glibran - AI Short Video Clipper & Generation SaaS

Glibran is a full-stack SaaS platform designed for content creators to turn long-form podcast or stream footage into highly engaging, viral 9:16 short-form vertical clips using advanced computer vision and LLM intelligence.

---

## System Architecture & Tech Stack

Our solution implements a split-cloud architecture separating heavy-compute workloads from high-latency user interactions for peak efficiency.

### Frontend & API Mesh (`/frontend`)
*   **Framework**: Next.js 16 (App Router + React Server Components)
*   **Auth**: NextAuth with Google OAuth provider 
*   **Styling**: React Tailwind CSS 4 + ShadCN UI
*   **Postgres ORM**: Prisma Client for edge-compatible speed connecting back to **Neon DB**
*   **Queuing & Background Jobs**: Inngest workflow engine
*   **Monetization**: Credit deductions secured proxy tracking linking directly to user balances driven via **Mayar API endpoints**.

### Heavy-Compute Backend (`/backend`)
*   **Framework**: FastAPI Python
*   **Infrastructure Layout**: Serverless GPU containers leveraging **Modal**
*   **Asset Processing**: 
    *   WhisperX for timestamped, high-fidelity transcription pipelines.
    *   **Gemini 2.5 Flash API** acting as context extractor tracking peaks for "viral scores".
    *   LR-ASD and custom FFMpeg macros resizing and burning captions accurately.

---

## Core User Flow

1.  **Dashboard Hub**: Users login and securely upload media objects directly into an **AWS S3 Bucket** via a Pre-signed Signed URI handshake inside the dashboard.
2.  **Inngest Webhook Pipeline**: NextJS captures the upload finish event emitting an async `video.upload` node out towards Inngest serverless workers framework.
3.  **FastAPI Request (Modal GPU)**: Modal takes download handle securely parsing stream to run WhisperX timestamps feeding nodes to **Gemini**.
4.  **The Rendering Routine**: Modal burns captions vertically outputs `.mp4` push hooks updating Prisma Neon tracking complete nodes back down front desk display renders dashboard item view layouts.

---

## Setup Instructions

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## Directories Layout Index
*   `frontend/` - React static client view layers mesh inside Next router.
*   `backend/` - Heavyweight inference mesh leveraging cloud mesh endpoints.

---
*Created with love for Hackathons.*
