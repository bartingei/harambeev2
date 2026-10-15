import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { campaignLifecycle } from "./campaigns";

// Single M-Pesa transaction ceiling.
export const MAX_MPESA_AMOUNT = 250_000;

export type PaymentSettingsView = {
  configured: boolean;
  shortcodeType: "till" | "paybill";
  businessShortcode: string;
  tillNumber: string;
  accountReference: string;
  displayName: string;
  updatedAt: string | null;
};

export type DonationStatus = {
  status: "pending" | "success" | "failed";
  amount: number;
  receipt: string | null;
  message: string;
};

async function loadOrganizerMpesa(ownerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const mpesa = await import("./mpesa.server");
  const { data: row } = await supabaseAdmin
    .from("organizer_payment_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!row) return null;
  const [consumerKey, consumerSecret, passkey] = await Promise.all([
    mpesa.decryptSecret(row.consumer_key_enc),
    mpesa.decryptSecret(row.consumer_secret_enc),
    mpesa.decryptSecret(row.passkey_enc),
  ]);
  return {
    creds: { consumerKey, consumerSecret, passkey },
    shortcode: {
      shortcodeType: row.shortcode_type as "till" | "paybill",
      businessShortcode: row.business_shortcode,
      tillNumber: row.till_number,
      accountReference: row.account_reference,
    },
    displayName: row.display_name,
  };
}

/** Human-readable outcome for Daraja result codes donors commonly hit. */
function describeFailure(code: number | null, desc: string | null): string {
  switch (code) {
    case 1032:
      return "You cancelled the M-Pesa prompt. No money was taken.";
    case 1:
      return "Your M-Pesa balance is too low for this amount.";
    case 2001:
      return "The M-Pesa PIN was wrong. No money was taken.";
    case 1037:
      return "We couldn't reach your phone. Check it's on and try again.";
    case 1019:
      return "The prompt expired before it was answered. Try again.";
    default:
      return desc || "The payment didn't go through. No money was taken.";
  }
}

export const startDonation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        campaignId: z.string().uuid(),
        amount: z.number().int().min(1).max(MAX_MPESA_AMOUNT),
        phone: z.string().trim().min(9).max(16),
        donorName: z.string().trim().max(60).optional().default(""),
        message: z.string().trim().max(500).optional().default(""),
        isAnonymous: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ requestId: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mpesa = await import("./mpesa.server");

    const phone = mpesa.normalizeKenyanPhone(data.phone);
    if (!phone) throw new Error("Enter a valid Safaricom number, e.g. 0712 345 678.");

    const { data: campaign } = await supabaseAdmin
      .from("campaigns")
      .select("id, title, status, deadline, creator_id")
      .eq("id", data.campaignId)
      .maybeSingle();
    if (!campaign || !campaignLifecycle(campaign.deadline, campaign.status).isAcceptingDonations) {
      throw new Error("This campaign isn't accepting donations.");
    }
    const organizer = campaign.creator_id ? await loadOrganizerMpesa(campaign.creator_id) : null;
    if (!campaign.creator_id || !organizer) {
      throw new Error("This organizer hasn't finished setting up M-Pesa yet.");
    }

    // Stop one number being flooded with prompts.
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("payment_requests")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", since);
    if ((count ?? 0) >= 3) {
      throw new Error("Too many prompts sent to this number. Wait two minutes and try again.");
    }

    const push = await mpesa.stkPush({
      creds: organizer.creds,
      shortcode: organizer.shortcode,
      phone,
      amount: data.amount,
      callbackUrl: mpesa.callbackUrl(),
      description: "Harambee",
    });

    const isAnonymous = data.isAnonymous || !data.donorName;
    const { data: request, error } = await supabaseAdmin
      .from("payment_requests")
      .insert({
        campaign_id: campaign.id,
        owner_id: campaign.creator_id,
        phone,
        amount: data.amount,
        donor_name: isAnonymous ? null : data.donorName,
        message: data.message || null,
        is_anonymous: isAnonymous,
        merchant_request_id: push.MerchantRequestID,
        checkout_request_id: push.CheckoutRequestID,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { requestId: request.id };
  });

export const getDonationStatus = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<DonationStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: initial } = await supabaseAdmin
      .from("payment_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!initial) throw new Error("Payment not found.");
    let req = initial;

    // Fallback if Safaricom's callback is slow or lost: ask Daraja directly, at most
    // every 10s and only once the donor has had time to enter their PIN.
    const age = Date.now() - new Date(req.created_at).getTime();
    const sinceCheck = req.last_checked_at
      ? Date.now() - new Date(req.last_checked_at).getTime()
      : Infinity;
    if (req.status === "pending" && age > 20_000 && sinceCheck > 10_000) {
      await supabaseAdmin
        .from("payment_requests")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", req.id);
      try {
        const organizer = await loadOrganizerMpesa(req.owner_id);
        if (organizer) {
          const mpesa = await import("./mpesa.server");
          const result = await mpesa.stkQuery({
            creds: organizer.creds,
            shortcode: organizer.shortcode,
            checkoutRequestId: req.checkout_request_id,
          });
          if (result) {
            const { data: settled, error } = await supabaseAdmin.rpc("complete_payment_request", {
              _checkout_request_id: req.checkout_request_id,
              _result_code: result.resultCode,
              _result_desc: result.resultDesc,
            });
            if (error) throw error;
            if (settled) req = settled;
          }
        }
      } catch (err) {
        console.error("[mpesa] status query failed", err);
      }
    }

    return {
      status: req.status as DonationStatus["status"],
      amount: Number(req.amount),
      receipt: req.mpesa_receipt,
      message:
        req.status === "failed"
          ? describeFailure(req.result_code, req.result_desc)
          : req.status === "success"
            ? "Payment confirmed."
            : "Waiting for you to enter your M-Pesa PIN…",
    };
  });

export const getPaymentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentSettingsView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("organizer_payment_settings")
      .select(
        "shortcode_type, business_shortcode, till_number, account_reference, display_name, updated_at",
      )
      .eq("owner_id", context.userId)
      .maybeSingle();
    return {
      configured: !!row,
      shortcodeType: (row?.shortcode_type as "till" | "paybill") ?? "till",
      businessShortcode: row?.business_shortcode ?? "",
      tillNumber: row?.till_number ?? "",
      accountReference: row?.account_reference ?? "Harambee",
      displayName: row?.display_name ?? "",
      updatedAt: row?.updated_at ?? null,
    };
  });

const shortcode = z
  .string()
  .trim()
  .regex(/^\d{5,8}$/, "Use the 5–8 digit number from Safaricom.");

export const savePaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        shortcodeType: z.enum(["till", "paybill"]),
        businessShortcode: shortcode,
        tillNumber: z.string().trim().optional().default(""),
        accountReference: z.string().trim().min(1).max(12),
        displayName: z.string().trim().min(2).max(80),
        // Blank means "keep what's saved".
        consumerKey: z.string().trim().max(200).optional().default(""),
        consumerSecret: z.string().trim().max(200).optional().default(""),
        passkey: z.string().trim().max(200).optional().default(""),
      })
      .superRefine((v, ctx) => {
        if (v.shortcodeType === "till" && !shortcode.safeParse(v.tillNumber).success) {
          ctx.addIssue({
            code: "custom",
            path: ["tillNumber"],
            message: "Enter your till number.",
          });
        }
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mpesa = await import("./mpesa.server");
    const existing = await loadOrganizerMpesa(context.userId);

    const creds = {
      consumerKey: data.consumerKey || existing?.creds.consumerKey || "",
      consumerSecret: data.consumerSecret || existing?.creds.consumerSecret || "",
      passkey: data.passkey || existing?.creds.passkey || "",
    };
    if (!creds.consumerKey || !creds.consumerSecret || !creds.passkey) {
      throw new Error("Enter your Daraja consumer key, consumer secret and passkey.");
    }
    // Fails fast on a typo'd key/secret instead of on a donor's first payment.
    await mpesa.getAccessToken(creds);

    const [consumerKeyEnc, consumerSecretEnc, passkeyEnc] = await Promise.all([
      mpesa.encryptSecret(creds.consumerKey),
      mpesa.encryptSecret(creds.consumerSecret),
      mpesa.encryptSecret(creds.passkey),
    ]);
    const { error } = await supabaseAdmin.from("organizer_payment_settings").upsert({
      owner_id: context.userId,
      shortcode_type: data.shortcodeType,
      business_shortcode: data.businessShortcode,
      till_number: data.shortcodeType === "till" ? data.tillNumber : null,
      account_reference: data.accountReference,
      display_name: data.displayName,
      consumer_key_enc: consumerKeyEnc,
      consumer_secret_enc: consumerSecretEnc,
      passkey_enc: passkeyEnc,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
