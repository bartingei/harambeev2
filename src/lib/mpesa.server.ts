// Safaricom Daraja (M-Pesa Express / STK Push) client and secret helpers.
// Server-only: load inside handlers with `await import("@/lib/mpesa.server")`.

export type MpesaCredentials = {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

export type MpesaShortcode = {
  shortcodeType: "till" | "paybill";
  businessShortcode: string;
  tillNumber: string | null;
  accountReference: string;
};

function baseUrl(): string {
  return process.env["MPESA_ENV"] === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

/** Accepts 07XX…, 01XX…, 7XX…, +2547XX…, 2547XX… and returns 2547XXXXXXXX / 2541XXXXXXXX. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  let local: string;
  if (digits.startsWith("254")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;
  return /^[71]\d{8}$/.test(local) ? `254${local}` : null;
}

/** Daraja wants YYYYMMDDHHmmss in Kenyan time. */
function timestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

export async function getAccessToken(
  creds: Pick<MpesaCredentials, "consumerKey" | "consumerSecret">,
) {
  const basic = btoa(`${creds.consumerKey}:${creds.consumerSecret}`);
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    throw new Error(`M-Pesa rejected the consumer key/secret (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("M-Pesa did not return an access token.");
  return body.access_token;
}

type StkPushResponse = {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
};

export async function stkPush(opts: {
  creds: MpesaCredentials;
  shortcode: MpesaShortcode;
  phone: string;
  amount: number;
  callbackUrl: string;
  description: string;
}): Promise<StkPushResponse> {
  const token = await getAccessToken(opts.creds);
  const ts = timestamp();
  const { shortcode } = opts;
  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode.businessShortcode,
      Password: btoa(`${shortcode.businessShortcode}${opts.creds.passkey}${ts}`),
      Timestamp: ts,
      TransactionType:
        shortcode.shortcodeType === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: Math.round(opts.amount),
      PartyA: opts.phone,
      PartyB:
        shortcode.shortcodeType === "till" ? shortcode.tillNumber : shortcode.businessShortcode,
      PhoneNumber: opts.phone,
      CallBackURL: opts.callbackUrl,
      AccountReference: shortcode.accountReference.slice(0, 12),
      TransactionDesc: opts.description.slice(0, 13),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<StkPushResponse> & {
    errorMessage?: string;
  };
  if (!res.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID) {
    throw new Error(
      body.errorMessage || body.ResponseDescription || "M-Pesa couldn't send the prompt.",
    );
  }
  return body as StkPushResponse;
}

/** Asks Daraja for the outcome of a push whose callback hasn't arrived. */
export async function stkQuery(opts: {
  creds: MpesaCredentials;
  shortcode: MpesaShortcode;
  checkoutRequestId: string;
}): Promise<{ resultCode: number; resultDesc: string } | null> {
  const token = await getAccessToken(opts.creds);
  const ts = timestamp();
  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: opts.shortcode.businessShortcode,
      Password: btoa(`${opts.shortcode.businessShortcode}${opts.creds.passkey}${ts}`),
      Timestamp: ts,
      CheckoutRequestID: opts.checkoutRequestId,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ResultCode?: string | number;
    ResultDesc?: string;
  };
  // While the customer is still on the PIN prompt Daraja answers with an error, not a result.
  if (!res.ok || body.ResultCode === undefined) return null;
  return { resultCode: Number(body.ResultCode), resultDesc: body.ResultDesc ?? "" };
}

export type StkCallback = {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  receipt: string | null;
  amount: number | null;
};

export function parseStkCallback(payload: unknown): StkCallback | null {
  const cb = (payload as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
  const items =
    (cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] } | undefined)?.Item ?? [];
  const item = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = item("MpesaReceiptNumber");
  const amount = item("Amount");
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ""),
    receipt: typeof receipt === "string" ? receipt : null,
    amount: typeof amount === "number" ? amount : amount != null ? Number(amount) : null,
  };
}

export function callbackUrl(): string {
  const appUrl = process.env["PUBLIC_APP_URL"];
  const secret = process.env["MPESA_CALLBACK_SECRET"];
  if (!appUrl || !secret) {
    throw new Error("Payments aren't configured: set PUBLIC_APP_URL and MPESA_CALLBACK_SECRET.");
  }
  return `${appUrl.replace(/\/$/, "")}/api/public/mpesa/callback/${secret}`;
}

/** Constant-time comparison so the callback secret can't be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// --- Secret encryption (AES-256-GCM, key from MPESA_ENCRYPTION_KEY as 32 bytes base64) ---

async function encryptionKey(): Promise<CryptoKey> {
  const raw = process.env["MPESA_ENCRYPTION_KEY"];
  if (!raw) throw new Error("Payments aren't configured: set MPESA_ENCRYPTION_KEY.");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32)
    throw new Error("MPESA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(plain),
  );
  return `${toB64(iv)}.${toB64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [iv, data] = stored.split(".");
  if (!iv || !data) throw new Error("Stored M-Pesa secret is corrupt.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    await encryptionKey(),
    fromB64(data),
  );
  return new TextDecoder().decode(plain);
}
