"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { generatePresignedUrl } from "./s3";
import { inngest } from "@/inngest/client";
import { revalidatePath } from "next/cache";

import { CLIP_COST, THUMBNAIL_COST, AVATAR_COST } from "./constants";

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

// ---------------------------------------------------------------------------
// Thumbnail Generation
// ---------------------------------------------------------------------------
export async function createThumbnailJob(s3Key: string, headline: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { error: "Not authenticated" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { creditsAmount: true },
  });
  if (!user || user.creditsAmount < THUMBNAIL_COST) {
    return { error: "Insufficient credits." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { creditsAmount: { decrement: THUMBNAIL_COST } },
  });

  const job = await prisma.job.create({
    data: {
      userId: session.user.id,
      type: "THUMBNAIL_GENERATION",
      status: "PENDING",
      inputUrl: s3Key,
      cost: THUMBNAIL_COST,
    },
  });

  await inngest.send({
    name: "thumbnail.requested",
    data: { jobId: job.id, imageS3Key: s3Key, headline, userId: session.user.id },
  });

  revalidatePath("/dashboard");
  return { success: true, jobId: job.id };
}

// ---------------------------------------------------------------------------
// Avatar Generation
// ---------------------------------------------------------------------------
export async function createAvatarJob(s3Key: string, scriptText: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { error: "Not authenticated" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { creditsAmount: true },
  });
  if (!user || user.creditsAmount < AVATAR_COST) {
    return { error: "Insufficient credits." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { creditsAmount: { decrement: AVATAR_COST } },
  });

  const job = await prisma.job.create({
    data: {
      userId: session.user.id,
      type: "AVATAR_GENERATION",
      status: "PENDING",
      inputUrl: s3Key,
      cost: AVATAR_COST,
    },
  });

  await inngest.send({
    name: "avatar.requested",
    data: { jobId: job.id, photoS3Key: s3Key, scriptText, userId: session.user.id },
  });

  revalidatePath("/dashboard");
  return { success: true, jobId: job.id };
}

export async function getPresignedImageUploadUrl(fileName: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { error: "Not authenticated" };

  const s3Key = `raw/${session.user.id}/${Date.now()}_${fileName}`;
  const url = await generatePresignedUrl(s3Key, "image/png");
  return { url, s3Key };
}
