import { createFileRoute } from "@tanstack/react-router";

// Safaricom posts the STK result here. Daraja doesn't sign callbacks, so we accept only a
// secret token in the URL plus a CheckoutRequestID we issued and still have pending.
const ACK = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });

export const Route = createFileRoute("/api/public/mpesa/callback/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const mpesa = await import("@/lib/mpesa.server");
        const secret = process.env["MPESA_CALLBACK_SECRET"];
        if (!secret || !mpesa.safeEqual(params.token, secret)) {
          return new Response("Not found", { status: 404 });
        }

        const result = mpesa.parseStkCallback(await request.json().catch(() => null));
        if (!result) return ACK();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("complete_payment_request", {
          _checkout_request_id: result.checkoutRequestId,
          _result_code: result.resultCode,
          _result_desc: result.resultDesc,
          _mpesa_receipt: result.receipt ?? undefined,
          _amount: result.amount ?? undefined,
        });
        if (error) {
          // The donor's status polling re-checks with Daraja, so this request isn't lost.
          console.error("[mpesa] callback settle failed", error);
          return new Response("Retry", { status: 500 });
        }
        return ACK();
      },
    },
  },
});
