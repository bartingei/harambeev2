import { createFileRoute } from "@tanstack/react-router";

// Safaricom posts the outcome of a B2B payout here (same secret-in-URL scheme as the STK callback).
const ACK = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });

export const Route = createFileRoute("/api/public/mpesa/b2b-result/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const mpesa = await import("@/lib/mpesa.server");
        const secret = process.env["MPESA_CALLBACK_SECRET"];
        if (!secret || !mpesa.safeEqual(params.token, secret)) {
          return new Response("Not found", { status: 404 });
        }
        const result = mpesa.parseB2bResult(await request.json().catch(() => null));
        if (!result) return ACK();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // The result can beat our own write of the originator id by a moment; retry briefly.
        for (let attempt = 0; attempt < 4; attempt++) {
          const { data, error } = await supabaseAdmin.rpc("complete_payout", {
            _originator: result.originatorConversationId,
            _result_code: result.resultCode,
            _result_desc: result.resultDesc,
            _receipt: result.receipt ?? undefined,
          });
          if (error) {
            console.error("[mpesa] payout settle failed", error);
            return new Response("Retry", { status: 500 });
          }
          if (data?.id) return ACK();
          await new Promise((r) => setTimeout(r, 1000));
        }
        console.error(
          "[mpesa] payout result for unknown conversation",
          result.originatorConversationId,
        );
        return ACK();
      },
    },
  },
});
