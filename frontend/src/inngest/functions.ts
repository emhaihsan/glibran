import { inngest } from "./client";
import { prisma } from "@/lib/prisma";

// Shared failure handler – refund credits
async function refundOnFailure(eventData: any) {
  const { jobId, userId } = eventData;
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (job && job.status !== "COMPLETED") {
      await prisma.job.update({ where: { id: jobId }, data: { status: "FAILED" } });
      await prisma.user.update({
        where: { id: userId },
        data: { creditsAmount: { increment: job.cost } },
      });
      console.log(`[Inngest] Refunded ${job.cost} credits for job ${jobId}`);
    }
  } catch (err) {
    console.error("[Inngest] Refund failed:", err);
  }
}

// Helper: mark processing + call Modal endpoint
async function callModal(jobId: string, endpoint: string, body: Record<string, any>) {
  await prisma.job.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

  const modalUrl = process.env.MODAL_BACKEND_URL;
  if (!modalUrl) throw new Error("MODAL_BACKEND_URL not configured");

  const res = await fetch(`${modalUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Modal ${endpoint} returned ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Video Clipper
// ---------------------------------------------------------------------------
export const processVideoClip = inngest.createFunction(
  {
    id: "process-video-clip",
    onFailure: async ({ event }) => refundOnFailure(event.data.event.data),
  },
  { event: "video.uploaded" },
  async ({ event, step }) => {
    const { videoS3Key, jobId } = event.data;
    await step.run("process", () =>
      callModal(jobId, "/process-video", { job_id: jobId, video_s3_key: videoS3Key })
    );
    return { success: true, jobId };
  }
);

// ---------------------------------------------------------------------------
// 2. Thumbnail Generator
// ---------------------------------------------------------------------------
export const processThumbnail = inngest.createFunction(
  {
    id: "process-thumbnail",
    onFailure: async ({ event }) => refundOnFailure(event.data.event.data),
  },
  { event: "thumbnail.requested" },
  async ({ event, step }) => {
    const { imageS3Key, jobId, headline } = event.data;
    await step.run("process", () =>
      callModal(jobId, "/generate-thumbnail", {
        job_id: jobId,
        image_s3_key: imageS3Key,
        headline: headline || "YOUR TEXT HERE",
      })
    );
    return { success: true, jobId };
  }
);

// ---------------------------------------------------------------------------
// 3. AI Avatar
// ---------------------------------------------------------------------------
export const processAvatar = inngest.createFunction(
  {
    id: "process-avatar",
    onFailure: async ({ event }) => refundOnFailure(event.data.event.data),
  },
  { event: "avatar.requested" },
  async ({ event, step }) => {
    const { photoS3Key, jobId, scriptText } = event.data;
    await step.run("process", () =>
      callModal(jobId, "/generate-avatar", {
        job_id: jobId,
        photo_s3_key: photoS3Key,
        script_text: scriptText,
      })
    );
    return { success: true, jobId };
  }
);
