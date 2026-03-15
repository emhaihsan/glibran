import { inngest } from "./client";
import { prisma } from "@/lib/prisma";

export const processVideoClip = inngest.createFunction(
  {
    id: "process-video-clip",
    onFailure: async ({ event }) => {
      // Refund credits on failure
      const { jobId, userId } = event.data.event.data;
      try {
        const job = await prisma.job.findUnique({ where: { id: jobId } });
        if (job && job.status !== "COMPLETED") {
          await prisma.job.update({
            where: { id: jobId },
            data: { status: "FAILED" },
          });
          await prisma.user.update({
            where: { id: userId },
            data: { creditsAmount: { increment: job.cost } },
          });
          console.log(`[Inngest] Refunded ${job.cost} credits to user ${userId} for failed job ${jobId}`);
        }
      } catch (err) {
        console.error("[Inngest] Failed to refund credits:", err);
      }
    },
  },
  { event: "video.uploaded" },
  async ({ event, step }) => {
    const { videoS3Key, jobId, userId } = event.data;

    // Step 1: Mark job as PROCESSING
    await step.run("update-job-status-processing", async () => {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "PROCESSING" },
      });
    });

    // Step 2: Call Modal backend (fire-and-forget – Modal will callback via webhook)
    await step.run("call-modal-backend", async () => {
      const modalUrl = process.env.MODAL_BACKEND_URL;
      if (!modalUrl) throw new Error("MODAL_BACKEND_URL not configured");

      const response = await fetch(`${modalUrl}/process-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, video_s3_key: videoS3Key }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Modal backend returned ${response.status}: ${text}`);
      }

      return await response.json();
    });

    return { success: true, jobId };
  }
);
