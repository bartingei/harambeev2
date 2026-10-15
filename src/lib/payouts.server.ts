// Pays organizers' owed donations to their Buy Goods tills via Daraja B2B.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as mpesa from "./mpesa.server";

export type PayoutOutcome =
  | { status: "skipped" }
  | { status: "sent"; payoutId: string; amount: number }
  | { status: "rejected"; amount: number; reason: string }
  | { status: "unknown"; payoutId: string; amount: number };

export async function runPayoutForOwner(
  ownerId: string,
  minAmount = mpesa.payoutConfig().minAmount,
): Promise<PayoutOutcome> {
  const cfg = mpesa.payoutConfig();
  const platform = mpesa.platformMpesa();

  const { data: payout, error } = await supabaseAdmin.rpc("claim_payout", {
    _owner: ownerId,
    _min: minAmount,
  });
  if (error) throw new Error(error.message);
  if (!payout?.id) return { status: "skipped" };
  const amount = Number(payout.amount);

  try {
    const sent = await mpesa.b2bBuyGoods({
      ...platform,
      initiator: cfg.initiator,
      securityCredential: cfg.securityCredential,
      tillNumber: payout.till_number,
      amount,
      resultUrl: mpesa.secretUrl("/api/public/mpesa/b2b-result"),
      timeoutUrl: mpesa.secretUrl("/api/public/mpesa/b2b-timeout"),
      remarks: `Harambee payout ${payout.id.slice(0, 8)}`,
    });
    await supabaseAdmin
      .from("payouts")
      .update({
        originator_conversation_id: sent.originatorConversationId,
        conversation_id: sent.conversationId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payout.id);
    return { status: "sent", payoutId: payout.id, amount };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof mpesa.MpesaRejected) {
      await supabaseAdmin.rpc("release_unsent_payout", { _payout: payout.id, _reason: reason });
      return { status: "rejected", amount, reason };
    }
    // The transfer may or may not have gone through. Hold the money in 'unknown' so nothing
    // is paid twice; it blocks further payouts to this organizer until someone checks.
    console.error("[payout] outcome unknown", payout.id, reason);
    await supabaseAdmin
      .from("payouts")
      .update({ status: "unknown", result_desc: reason, updated_at: new Date().toISOString() })
      .eq("id", payout.id);
    return { status: "unknown", payoutId: payout.id, amount };
  }
}

export async function runAllPayouts(): Promise<{ checked: number; outcomes: PayoutOutcome[] }> {
  const { data } = await supabaseAdmin
    .from("payment_requests")
    .select("owner_id")
    .eq("status", "success")
    .eq("payout_status", "pending");
  const owners = [...new Set((data ?? []).map((r) => r.owner_id))];
  const outcomes: PayoutOutcome[] = [];
  for (const owner of owners) {
    try {
      outcomes.push(await runPayoutForOwner(owner));
    } catch (err) {
      console.error("[payout] failed for owner", owner, err);
    }
  }
  return { checked: owners.length, outcomes };
}
