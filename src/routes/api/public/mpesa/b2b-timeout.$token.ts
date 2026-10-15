import { createFileRoute } from "@tanstack/react-router";

// Safaricom couldn't process the payout in time. The outcome is unknown, so flag it for a human
// instead of retrying: a retry could pay the organizer twice.
export const Route = createFileRoute("/api/public/mpesa/b2b-timeout/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const mpesa = await import("@/lib/mpesa.server");
        const secret = process.env["MPESA_CALLBACK_SECRET"];
        if (!secret || !mpesa.safeEqual(params.token, secret)) {
          return new Response("Not found", { status: 404 });
        }
        const result = mpesa.parseB2bResult(await request.json().catch(() => null));
        if (result) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("payouts")
            .update({
              status: "unknown",
              result_desc: "Safaricom timed out; verify in the M-Pesa portal before retrying.",
              updated_at: new Date().toISOString(),
            })
            .eq("originator_conversation_id", result.originatorConversationId)
            .eq("status", "initiated");
        }
        return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
      },
    },
  },
});
