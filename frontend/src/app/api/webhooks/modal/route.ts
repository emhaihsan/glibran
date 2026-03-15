import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { job_id, status, clips, error: errorMsg } = body;

    if (!job_id || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Fetch job to get userId and cost for potential refund
    const existingJob = await prisma.job.findUnique({
      where: { id: job_id },
      select: { userId: true, cost: true, status: true },
    });

    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Don't update if already in a terminal state
    if (existingJob.status === "COMPLETED" || existingJob.status === "FAILED") {
      return NextResponse.json({ success: true, message: "Job already in terminal state" });
    }

    // Update job status
    const job = await prisma.job.update({
      where: { id: job_id },
      data: {
        status: status,
        resultUrl: clips && clips.length > 0 ? JSON.stringify(clips) : null,
      },
    });

    // Refund credits on failure
    if (status === "FAILED" && existingJob.userId) {
      await prisma.user.update({
        where: { id: existingJob.userId },
        data: { creditsAmount: { increment: existingJob.cost } },
      });
      console.log(`[Webhook] Refunded ${existingJob.cost} credits to ${existingJob.userId}`);
    }

    console.log(`[Webhook] Job ${job_id} updated to ${status}`);
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
