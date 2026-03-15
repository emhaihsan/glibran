const MAYAR_API_BASE = "https://api.mayar.id";
const MAYAR_API_KEY = process.env.MAYAR_API_KEY!;

async function mayarFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${MAYAR_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${MAYAR_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const json = await res.json();
  if (json.statusCode !== 200 && !res.ok) {
    throw new Error(
      `Mayar API error: ${json.message || json.messages || res.statusText}`
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// ReqPayment – Create a one-time payment link for credit top-ups
// POST /hl/v1/payment/create
// ---------------------------------------------------------------------------
export async function createPaymentRequest(params: {
  name: string;
  email: string;
  mobile: string;
  amount: number;
  description: string;
  redirectUrl: string;
  expiredAt: string;
}) {
  const data = await mayarFetch("/hl/v1/payment/create", {
    method: "POST",
    body: JSON.stringify(params),
  });
  // data.data contains { id, transaction_id, transactionId, link }
  return data.data as {
    id: string;
    transaction_id: string;
    transactionId: string;
    link: string;
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (HMAC-SHA512)
// ---------------------------------------------------------------------------
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string
): Promise<boolean> {
  const secret = process.env.MAYAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("MAYAR_WEBHOOK_SECRET not configured");
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computed === signatureHeader;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Credit-Based Product APIs (optional sync with Mayar credit system)
// ---------------------------------------------------------------------------

/** Spend customer credit on Mayar side */
export async function spendCustomerCredit(params: {
  memberId?: string;
  customerId?: string;
  productId: string;
  membershipTierId: string;
  amount: number;
}) {
  return mayarFetch("/credit/v1/credit/customer/spend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Add credit to customer on Mayar side */
export async function addCustomerCredit(params: {
  memberId?: string;
  customerId?: string;
  productId: string;
  membershipTierId: string;
  amount: number;
}) {
  return mayarFetch("/credit/v1/credit/customer/add-credit", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Get customer credit balance from Mayar */
export async function getCustomerBalance(params: {
  productId: string;
  membershipTierId: string;
  memberId?: string;
  customerId?: string;
}) {
  const qs = new URLSearchParams();
  qs.set("productId", params.productId);
  qs.set("membershipTierId", params.membershipTierId);
  if (params.memberId) qs.set("memberId", params.memberId);
  if (params.customerId) qs.set("customerId", params.customerId);

  return mayarFetch(`/credit/v1/credit/customer/balance?${qs.toString()}`, {
    method: "GET",
  });
}

/** Register a new credit-based membership customer on Mayar */
export async function registerCreditCustomer(params: {
  productId: string;
  membershipTierId: string;
  membershipMonthlyPeriod: number;
  trialCredit?: number;
  customerInfo: { name: string; email: string; mobile: string };
}) {
  return mayarFetch("/credit/v1/credit/membership/customer/regist", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Generate immutable checkout link for credit purchase */
export async function generateImmutableCheckout(params: {
  productId: string;
  creditAmount?: number;
  customerInfo: { name: string; email: string; mobile: string };
}) {
  return mayarFetch("/credit/v1/credit/generate/immutable/checkout", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
