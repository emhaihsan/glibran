import { inngest } from "./client";
import { prisma } from "@/lib/prisma";

export const processVideoClip = inngest.createFunction(
  { id: "process-video-clip" },
  { event: "video.uploaded" },
  async ({ event, step }) => {
    const { videoS3Key, jobId } = event.data;

    await step.run("update-job-status-processing", async () => {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "PROCESSING" },
      });
    });

    const backendResult = await step.run("call-modal-backend", async () => {
      const response = await fetch(`${process.env.MODAL_BACKEND_URL}/process-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, video_s3_key: videoS3Key }),
      });

      if (!response.ok) {
        throw new Error("Modal backend processing failed");
      }

      return await response.json();
    });

    return { success: true, backendResult };
  }
);
