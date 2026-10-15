import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { CampaignCard } from "@/components/CampaignCard";
import { listActiveCampaigns } from "@/lib/campaigns.functions";
import { useState } from "react";

const campaignsQuery = queryOptions({
  queryKey: ["campaigns", "active"],
  queryFn: () => listActiveCampaigns(),
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Harambee — Crowdfunding for Kenya" },
      { name: "description", content: "Start, share, and support harambees. Real causes, real people, M-Pesa simple." },
      { property: "og:title", content: "Harambee — Crowdfunding for Kenya" },
      { property: "og:description", content: "Start, share, and support harambees. Real causes, real people, M-Pesa simple." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(campaignsQuery),
  component: Discovery,
  errorComponent: () => (
    <div className="app-shell px-5 py-24 text-center">
      <p className="text-sm text-muted-foreground">We couldn't load the campaigns. Please refresh.</p>
    </div>
  ),
});

const filters = ["All", "Medical", "Education", "Community", "Other"] as const;

function Discovery() {
  const { data: all } = useSuspenseQuery(campaignsQuery);
  const [active, setActive] = useState<(typeof filters)[number]>("All");

  const list =
    active === "All" ? all : all.filter((c) => c.category === active.toLowerCase());

  const totalRaised = all.reduce((s, c) => s + c.raised, 0);

  return (
    <div className="app-shell pb-12">
      <AppHeader />

      <section className="px-5 pb-6 pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-flag-red">
          Harambee · Tuko pamoja
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold leading-[1.05] text-foreground">
          When we pull <span className="text-primary">together,</span> we lift each other.
        </h1>
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </span>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Raised on Harambee</p>
            <p className="font-display text-lg font-bold text-foreground">
              KES {Math.round(totalRaised).toLocaleString("en-KE")}
            </p>
          </div>
          <p className="text-right text-[11px] text-muted-foreground">
            {all.length}<br/>causes
          </p>
        </div>
      </section>

      <nav className="sticky top-[65px] z-20 -mx-px flex gap-2 overflow-x-auto border-b border-border/60 bg-background/90 px-5 py-3 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filters.map((f) => {
          const isActive = f === active;
          return (
            <button
              key={f}
              onClick={() => setActive(f)}
              className={
                "whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-colors " +
                (isActive
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-muted")
              }
            >
              {f}
            </button>
          );
        })}
      </nav>

      <section className="space-y-4 px-5 pt-5">
        {list.map((c) => (
          <CampaignCard key={c.id} c={c} />
        ))}
        {list.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No campaigns in this category yet.
          </p>
        )}
      </section>
    </div>
  );
}
