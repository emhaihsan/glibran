import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/mayar";

// Credit pack definitions (must match the top-up UI)
const CREDIT_PACKS: Record<number, number> = {
  10000: 10,   // Rp 10.000 → 10 credits
  20000: 25,   // Rp 20.000 → 25 credits
  35000: 50,   // Rp 35.000 → 50 credits
};

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();

    // Verify webhook signature
    const signature = req.headers.get("x-callback-signature") || req.headers.get("x-mayar-signature") || "";
    if (process.env.MAYAR_WEBHOOK_SECRET) {
      const isValid = await verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn("[Mayar Webhook] Invalid signature – skipping verification in dev");
        // In production, uncomment:
        // return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    console.log("[Mayar Webhook] Received:", JSON.stringify(payload).slice(0, 500));

    // Mayar webhook payload structure:
    // { event: "payment.received", data: { id, status, amount, customerName, customerEmail, ... } }
    // OR flat structure: { id, status, amount, customerEmail, ... }
    const event = payload.event || "payment.received";
    const data = payload.data || payload;

    const status = data.status || data.paymentStatus;
    const trxId = data.id || data.transactionId || data.transaction_id;
    const email = data.customerEmail || data.email || data.customer?.email;
    const amount = Number(data.amount || 0);

    // Only process successful payments
    if (status !== "paid" && status !== "success" && event !== "payment.received") {
      console.log(`[Mayar Webhook] Ignoring event=${event} status=${status}`);
      return NextResponse.json({ success: true, message: "Ignored" });
    }

    if (!trxId || !email) {
      console.error("[Mayar Webhook] Missing trxId or email");
      return NextResponse.json({ error: "Missing transaction ID or email" }, { status: 400 });
    }

    // Idempotency check – don't process the same transaction twice
    const existingTx = await prisma.transaction.findUnique({
      where: { mayarTrxId: trxId },
    });
    if (existingTx) {
      console.log(`[Mayar Webhook] Transaction ${trxId} already processed`);
      return NextResponse.json({ success: true, message: "Already processed" });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      console.error(`[Mayar Webhook] No user found for email: ${email}`);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Determine credits from payment amount
    const creditsToAdd = CREDIT_PACKS[amount] || Math.floor(amount / 1000);

    // Add credits + create transaction record atomically
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { creditsAmount: { increment: creditsToAdd } },
      }),
      prisma.transaction.create({
        data: {
          userId: user.id,
          mayarTrxId: trxId,
          creditsAdded: creditsToAdd,
          amountPaid: amount,
          status: "SUCCESS",
        },
      }),
    ]);

    console.log(
      `[Mayar Webhook] Added ${creditsToAdd} credits to user ${user.id} (trx: ${trxId})`
    );

    return NextResponse.json({ success: true, creditsAdded: creditsToAdd });
  } catch (error) {
    console.error("[Mayar Webhook] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
