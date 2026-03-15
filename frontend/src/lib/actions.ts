"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { generatePresignedUrl } from "./s3";
import { inngest } from "@/inngest/client";
import { revalidatePath } from "next/cache";

const CLIP_COST = 2;

export async function getPresignedUploadUrl(fileName: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const s3Key = `raw/${session.user.id}/${Date.now()}_${fileName}`;
  const url = await generatePresignedUrl(s3Key, "video/mp4");

  return { url, s3Key };
}

export async function createClipJob(s3Key: string, displayName: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: "Not authenticated" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { creditsAmount: true },
  });

  if (!user || user.creditsAmount < CLIP_COST) {
    return { error: "Insufficient credits. Please top up." };
  }

  // Deduct credits immediately to prevent double-spending
  await prisma.user.update({
    where: { id: session.user.id },
    data: { creditsAmount: { decrement: CLIP_COST } },
  });

  // Create job record
  const job = await prisma.job.create({
    data: {
      userId: session.user.id,
      type: "CLIP_GENERATION",
      status: "PENDING",
      inputUrl: s3Key,
      cost: CLIP_COST,
    },
  });

  // Fire Inngest event to start background processing
  await inngest.send({
    name: "video.uploaded",
    data: {
      jobId: job.id,
      videoS3Key: s3Key,
      userId: session.user.id,
      displayName,
    },
  });

  revalidatePath("/dashboard");
  return { success: true, jobId: job.id };
}

export async function refreshDashboard() {
  revalidatePath("/dashboard");
}
