"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { generatePresignedUrl } from "./s3";
import { inngest } from "@/inngest/client";
import { revalidatePath } from "next/cache";

import { CLIP_COST, CREDIT_PACKS } from "./constants";

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
// Mayar Top-Up – creates a ReqPayment link and returns the checkout URL
// ---------------------------------------------------------------------------


export async function createTopUpLink(packIndex: number) {
  const { createPaymentRequest } = await import("./mayar");
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return { error: "Not authenticated" };
  }

  const pack = CREDIT_PACKS[packIndex];
  if (!pack) {
    return { error: "Invalid credit pack" };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  if (!user || !user.email) {
    return { error: "User not found" };
  }

  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await createPaymentRequest({
      name: user.name || "Glibran User",
      email: user.email,
      mobile: "08000000000",
      amount: pack.priceIDR,
      description: `Glibran Top-Up: ${pack.label}`,
      redirectUrl: `${appUrl}/dashboard?topup=success`,
      expiredAt: expiry,
    });

    // result.link is the Mayar checkout URL path
    // Full URL depends on merchant subdomain. The API returns a full link.
    const checkoutUrl = result.link.startsWith("http")
      ? result.link
      : `https://mayar.id/${result.link}`;

    return { success: true, checkoutUrl };
  } catch (err: any) {
    console.error("[TopUp] Mayar API error:", err);
    return { error: err.message || "Failed to create payment link" };
  }
}
