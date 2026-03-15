import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { job_id, status, clips } = body;

    if (!job_id || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Update Job status
    const job = await prisma.job.update({
      where: { id: job_id },
      data: {
        status: status,
        resultUrl: clips ? JSON.stringify(clips) : null,
      },
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
