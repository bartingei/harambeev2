import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Called on a schedule (e.g. daily) with `Authorization: Bearer $LOVABLE_CRON_SECRET`.
export const Route = createFileRoute("/api/public/cron/run-payouts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runAllPayouts } = await import("@/lib/payouts.server");
        const { checked, outcomes } = await runAllPayouts();
        const count = (s: string) => outcomes.filter((o) => o.status === s).length;
        return Response.json({
          organizers: checked,
          sent: count("sent"),
          rejected: count("rejected"),
          unknown: count("unknown"),
        });
      },
    },
  },
});
