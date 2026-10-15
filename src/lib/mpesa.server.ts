// Safaricom Daraja (M-Pesa Express / STK Push) client and secret helpers.
// Server-only: load inside handlers with `await import("@/lib/mpesa.server")`.

export type MpesaCredentials = {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
};

export type MpesaShortcode = {
  shortcodeType: "till" | "paybill";
  /** The shortcode the passkey belongs to (store number for a till). */
  businessShortcode: string;
  /** Buy Goods only: the till that receives the money. */
  tillNumber: string | null;
  accountReference: string;
};

/** Harambee's own Daraja account, which collects every donation. */
export function platformMpesa(): { creds: MpesaCredentials; shortcode: MpesaShortcode } {
  const env = process.env;
  const consumerKey = env["MPESA_CONSUMER_KEY"];
  const consumerSecret = env["MPESA_CONSUMER_SECRET"];
  const passkey = env["MPESA_PASSKEY"];
  const businessShortcode = env["MPESA_SHORTCODE"];
  if (!consumerKey || !consumerSecret || !passkey || !businessShortcode) {
    throw new Error(
      "Payments aren't configured: set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY and MPESA_SHORTCODE.",
    );
  }
  const shortcodeType = env["MPESA_SHORTCODE_TYPE"] === "till" ? "till" : "paybill";
  return {
    creds: { consumerKey, consumerSecret, passkey },
    shortcode: {
      shortcodeType,
      businessShortcode,
      tillNumber: shortcodeType === "till" ? (env["MPESA_TILL_NUMBER"] ?? businessShortcode) : null,
      accountReference: "Harambee",
    },
  };
}

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

/** Callback URL on this app, guarded by the shared secret in the path. */
export function secretUrl(path: string): string {
  const appUrl = process.env["PUBLIC_APP_URL"];
  const secret = process.env["MPESA_CALLBACK_SECRET"];
  if (!appUrl || !secret) {
    throw new Error("Payments aren't configured: set PUBLIC_APP_URL and MPESA_CALLBACK_SECRET.");
  }
  return `${appUrl.replace(/\/$/, "")}${path}/${secret}`;
}

// --- B2B Buy Goods payouts (Harambee shortcode -> organizer till) ---

export function payoutConfig(): {
  initiator: string;
  securityCredential: string;
  minAmount: number;
} {
  const initiator = process.env["MPESA_INITIATOR_NAME"];
  const securityCredential = process.env["MPESA_SECURITY_CREDENTIAL"];
  if (!initiator || !securityCredential) {
    throw new Error(
      "Payouts aren't configured: set MPESA_INITIATOR_NAME and MPESA_SECURITY_CREDENTIAL.",
    );
  }
  const min = Number(process.env["MPESA_PAYOUT_MIN"] ?? 100);
  return { initiator, securityCredential, minAmount: Number.isFinite(min) && min >= 1 ? min : 100 };
}

/** Safaricom answered and refused: nothing was sent, so the payout is safe to retry. */
export class MpesaRejected extends Error {}

export async function b2bBuyGoods(opts: {
  creds: MpesaCredentials;
  shortcode: MpesaShortcode;
  initiator: string;
  securityCredential: string;
  tillNumber: string;
  amount: number;
  resultUrl: string;
  timeoutUrl: string;
  remarks: string;
}): Promise<{ originatorConversationId: string; conversationId: string }> {
  let token: string;
  try {
    token = await getAccessToken(opts.creds);
  } catch (err) {
    throw new MpesaRejected(
      err instanceof Error ? err.message : "Couldn't authenticate with M-Pesa.",
    );
  }
  // A thrown fetch here (network/timeout) is deliberately NOT MpesaRejected: the transfer may
  // have been accepted, so the caller must not retry blindly.
  const res = await fetch(`${baseUrl()}/mpesa/b2b/v1/paymentrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Initiator: opts.initiator,
      SecurityCredential: opts.securityCredential,
      CommandID: "BusinessBuyGoods",
      SenderIdentifierType: opts.shortcode.shortcodeType === "till" ? "2" : "4",
      RecieverIdentifierType: "2",
      Amount: Math.round(opts.amount),
      PartyA: opts.shortcode.businessShortcode,
      PartyB: opts.tillNumber,
      AccountReference: "Harambee",
      Remarks: opts.remarks.slice(0, 100),
      QueueTimeOutURL: opts.timeoutUrl,
      ResultURL: opts.resultUrl,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    OriginatorConversationID?: string;
    ConversationID?: string;
    ResponseCode?: string;
    ResponseDescription?: string;
    errorMessage?: string;
  };
  if (res.ok && body.ResponseCode === "0" && body.OriginatorConversationID) {
    return {
      originatorConversationId: body.OriginatorConversationID,
      conversationId: body.ConversationID ?? "",
    };
  }
  const message = body.errorMessage || body.ResponseDescription || `HTTP ${res.status}`;
  if (res.status >= 500) throw new Error(`M-Pesa error while sending payout: ${message}`);
  throw new MpesaRejected(message);
}

export type B2bResult = {
  originatorConversationId: string;
  resultCode: number;
  resultDesc: string;
  receipt: string | null;
};

export function parseB2bResult(payload: unknown): B2bResult | null {
  const r = (payload as { Result?: Record<string, unknown> })?.Result;
  if (!r || typeof r.OriginatorConversationID !== "string") return null;
  return {
    originatorConversationId: r.OriginatorConversationID,
    resultCode: Number(r.ResultCode),
    resultDesc: String(r.ResultDesc ?? ""),
    receipt: typeof r.TransactionID === "string" ? r.TransactionID : null,
  };
}
