import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { campaignLifecycle } from "./campaigns";

// Single M-Pesa transaction ceiling.
export const MAX_MPESA_AMOUNT = 250_000;

export type PaymentSettingsView = {
  configured: boolean;
  tillNumber: string;
  owed: number;
  processing: number;
  paid: number;
  minPayout: number;
};

export type DonationStatus = {
  status: "pending" | "success" | "failed";
  amount: number;
  receipt: string | null;
  message: string;
};

async function organizerTill(ownerId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("organizer_payment_settings")
    .select("till_number")
    .eq("owner_id", ownerId)
    .maybeSingle();
  return data?.till_number ?? null;
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
    if (!campaign.creator_id || !(await organizerTill(campaign.creator_id))) {
      throw new Error("This organizer hasn't added their till number yet.");
    }
    const platform = mpesa.platformMpesa();

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
      ...platform,
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
        {
          const mpesa = await import("./mpesa.server");
          const result = await mpesa.stkQuery({
            ...mpesa.platformMpesa(),
            checkoutRequestId: req.checkout_request_id,
          });
          if (result) {
            const { data: settled, error } = await supabaseAdmin.rpc("complete_payment_request", {
              _checkout_request_id: req.checkout_request_id,
              _result_code: result.resultCode,
              _result_desc: result.resultDesc,
            });
            if (error) throw error;
            if (settled?.id) req = settled;
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
    const till = await organizerTill(context.userId);
    const { data: summary } = await context.supabase.rpc("my_payout_summary");
    return {
      configured: !!till,
      tillNumber: till ?? "",
      owed: Number(summary?.[0]?.owed ?? 0),
      processing: Number(summary?.[0]?.processing ?? 0),
      minPayout: Number(process.env["MPESA_PAYOUT_MIN"] ?? 100) || 100,
      paid: Number(summary?.[0]?.paid ?? 0),
    };
  });

export const savePaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        tillNumber: z
          .string()
          .trim()
          .regex(/^\d{5,8}$/, "A Buy Goods till number is 5–8 digits."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("organizer_payment_settings").upsert({
      owner_id: context.userId,
      till_number: data.tillNumber,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requestPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ message: string }> => {
    const { runPayoutForOwner } = await import("./payouts.server");
    const out = await runPayoutForOwner(context.userId);
    switch (out.status) {
      case "sent":
        return { message: "Payout requested. It should reach your till within a few minutes." };
      case "rejected":
        throw new Error(`M-Pesa couldn't send the payout: ${out.reason}`);
      case "unknown":
        throw new Error(
          "We couldn't confirm the payout. We'll check it before sending anything more.",
        );
      default:
        throw new Error("Nothing to pay out yet, or a payout is already on its way.");
    }
  });
