import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { ProgressBar } from "@/components/ProgressBar";
import { useAuth } from "@/hooks/useAuth";
import { categoryLabel, formatKES, type CampaignDetail as CampaignDetailData, type Category } from "@/lib/campaigns";
import { getCampaignDetail, postCampaignUpdate } from "@/lib/campaigns.functions";
import { getDonationStatus, MAX_MPESA_AMOUNT, startDonation } from "@/lib/payments.functions";
import { Check, Smartphone, Share2, X, CircleAlert, Loader2 } from "lucide-react";

const detailQuery = (id: string) =>
  queryOptions({
    queryKey: ["campaign", id],
    queryFn: () => getCampaignDetail({ data: { id } }),
    staleTime: 1000 * 60 * 5,
  });

export const Route = createFileRoute("/campaign/$id")({
  head: ({ loaderData }) => {
    const c = (loaderData ?? null) as CampaignDetailData | null;
    const title = c ? `${c.title} — Harambee` : "Campaign — Harambee";
    const description = c
      ? `${formatKES(c.raised)} raised of ${formatKES(c.goal)} — read the story and support this harambee with M-Pesa.`
      : "Read the story, see the progress and support this harambee with M-Pesa.";
    const image = c?.image
      ? `https://harambeeyetu.lovable.app/api/public/campaign-image/${c.id}`
      : null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(image
          ? [
              { property: "og:image", content: image },
              { property: "og:image:secure_url", content: image },
              { property: "og:image:type", content: "image/jpeg" },
              { property: "og:image:width", content: "1024" },
              { property: "og:image:height", content: "768" },
              { property: "og:image:alt", content: c?.title ?? "Harambee campaign" },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
    };
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(detailQuery(params.id)),
  component: CampaignDetail,
  errorComponent: () => (
    <div className="app-shell flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm text-muted-foreground">We couldn't load this campaign.</p>
        <Link to="/" className="mt-3 block text-primary underline">Back to discovery</Link>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="app-shell flex min-h-screen items-center justify-center px-6 text-center">
      <Link to="/" className="text-primary underline">Back to discovery</Link>
    </div>
  ),
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const { data: campaign } = useSuspenseQuery(detailQuery(id));
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!campaign) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-6 text-center">
        <Link to="/" className="text-primary underline">Back to discovery</Link>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((campaign.raised / campaign.goal) * 100));
  const isOrganizer = !!user && !!campaign.creatorId && user.id === campaign.creatorId;

  const share = async () => {
    const url = `${window.location.origin}/campaign/${id}`;
    const text = `Support "${campaign.title}" on Harambee — every shilling counts: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: campaign.title, text, url });
        return;
      } catch {}
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="app-shell pb-32">
      <AppHeader back />

      {campaign.image && (
        <div className="relative">
          <img src={campaign.image} alt={campaign.title} className="aspect-[5/4] w-full object-cover" suppressHydrationWarning />
          <span className="absolute left-4 top-4 rounded-full bg-background/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-foreground backdrop-blur">
            {categoryLabel[campaign.category as Category] ?? "Other"}
          </span>
        </div>
      )}

      <div className="px-5 pt-5">
        <h1 className="font-display text-2xl font-bold leading-tight">{campaign.title}</h1>
        <div className="mt-2.5 flex items-center gap-2.5">
          {campaign.organizerPhoto ? (
            <img
              src={campaign.organizerPhoto}
              alt={campaign.organizer}
              loading="lazy"
              width={80}
              height={80}
              className="h-10 w-10 rounded-full object-cover"
              suppressHydrationWarning
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary">
              {campaign.organizer.charAt(0).toUpperCase()}
            </span>
          )}
          <p className="text-sm text-muted-foreground">
            Organized by{" "}
            <span className="font-semibold text-foreground">{campaign.organizer}</span>
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-display text-2xl font-bold text-primary">{formatKES(campaign.raised)}</p>
              <p className="text-xs text-muted-foreground">raised of {formatKES(campaign.goal)}</p>
            </div>
            <p className="font-display text-lg font-bold text-foreground">{pct}%</p>
          </div>
          <div className="mt-3">
            <ProgressBar raised={campaign.raised} goal={campaign.goal} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span><b className="text-foreground">{campaign.donorCount}</b> donors</span>
             <span>
               {campaign.deadline ? (
                 <><b className="text-foreground">{campaign.daysLeft}</b> days left</>
               ) : (
                 <b className="text-foreground">No deadline</b>
               )}
             </span>
          </div>
        </div>

        <section className="mt-6">
          <h2 className="font-display text-base font-bold">The story</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-foreground/85">
            {campaign.story}
          </p>
        </section>

        {isOrganizer && <PostUpdate campaignId={id} />}

        <section className="mt-7">
          <h2 className="font-display text-base font-bold">
            Donors <span className="text-muted-foreground">({campaign.donorCount})</span>
          </h2>
          <div className="mt-3 space-y-2.5">
            {campaign.donors.map((d, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary">
                  {d.name.charAt(0).toUpperCase()}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground">{d.when}</p>
                </div>
                <p className="font-display text-sm font-bold text-foreground">{formatKES(d.amount)}</p>
              </div>
            ))}
            {campaign.donors.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Be the first to give to this harambee.
              </p>
            )}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="font-display text-base font-bold">Updates</h2>
          <div className="mt-3 space-y-3">
            {campaign.updates.map((u) => (
              <div key={u.id} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-sm leading-relaxed text-foreground/85">{u.content}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-primary">{campaign.organizer}</span> · {u.when}
                </p>
              </div>
            ))}
            {campaign.updates.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                The organizer hasn't posted any updates yet.
              </p>
            )}
          </div>
        </section>

        <button
          onClick={share}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-3.5 text-sm font-semibold text-foreground"
        >
          <Share2 className="h-4 w-4" />
          Share this harambee
        </button>
      </div>

       <div className="fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t border-border/60 bg-background/95 px-5 py-4 backdrop-blur-md">
         {campaign.isAcceptingDonations && !campaign.payoutName ? (
           <div className="rounded-full bg-secondary py-4 text-center font-display text-base font-bold text-secondary-foreground">
             Donations open soon
           </div>
         ) : campaign.isAcceptingDonations ? (
           <button
             onClick={() => setOpen(true)}
             className="w-full rounded-full bg-accent py-4 font-display text-base font-bold text-accent-foreground transition-transform active:scale-[0.98]"
           >
             Donate Now
           </button>
         ) : (
           <div className="rounded-full bg-secondary py-4 text-center font-display text-base font-bold text-secondary-foreground">
             Campaign ended
           </div>
         )}
      </div>

      {open && campaign.payoutName && (
        <DonateModal campaignId={id} payoutName={campaign.payoutName} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function PostUpdate({ campaignId }: { campaignId: string }) {
  const post = useServerFn(postCampaignUpdate);
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const text = content.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await post({ data: { campaignId, content: text } });
      setContent("");
      await queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      toast.success("Update posted — your donors can see it now.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't post the update. Try again.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-bold">Post an update</h2>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Share a progress update with your donors..."
        className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-primary"
      />
      <button
        onClick={submit}
        disabled={posting || content.trim().length < 2}
        className="mt-3 w-full rounded-full bg-primary py-3 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {posting ? "Posting…" : "Post Update"}
      </button>
    </section>
  );
}

const quickAmounts = [200, 500, 1000, 5000];

// Safaricom's prompt times out after about a minute; give the callback some slack after that.
const GIVE_UP_AFTER_MS = 2 * 60 * 1000;

type Phase =
  | { kind: "form" }
  | { kind: "sending" }
  | { kind: "waiting"; requestId: string; startedAt: number }
  | { kind: "done"; amount: number; receipt: string | null }
  | { kind: "failed"; message: string }
  | { kind: "timeout" };

function DonateModal({
  campaignId,
  payoutName,
  onClose,
}: {
  campaignId: string;
  payoutName: string;
  onClose: () => void;
}) {
  const start = useServerFn(startDonation);
  const checkStatus = useServerFn(getDonationStatus);
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(500);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState("");
  const polling = useRef(false);

  const confirm = async () => {
    if (amount <= 0 || amount > MAX_MPESA_AMOUNT) return;
    setPhase({ kind: "sending" });
    setError("");
    try {
      const res = await start({
        data: {
          campaignId,
          amount,
          phone,
          donorName: anonymous ? "" : name.trim(),
          isAnonymous: anonymous,
        },
      });
      setPhase({ kind: "waiting", requestId: res.requestId, startedAt: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send the M-Pesa prompt. Try again.");
      setPhase({ kind: "form" });
    }
  };

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || polling.current) return;
      polling.current = true;
      try {
        const res = await checkStatus({ data: { requestId: phase.requestId } });
        if (cancelled) return;
        if (res.status === "success") {
          setPhase({ kind: "done", amount: res.amount, receipt: res.receipt });
          await queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
          await queryClient.invalidateQueries({ queryKey: ["campaigns", "active"] });
        } else if (res.status === "failed") {
          setPhase({ kind: "failed", message: res.message });
        } else if (Date.now() - phase.startedAt > GIVE_UP_AFTER_MS) {
          setPhase({ kind: "timeout" });
        }
      } catch {
        // Network blip — keep polling.
      } finally {
        polling.current = false;
      }
    };
    const timer = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, checkStatus, campaignId, queryClient]);

  const busy = phase.kind === "sending" || phase.kind === "waiting";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-[480px] rounded-t-3xl border-t border-border bg-background p-5 pb-8">
        {phase.kind === "done" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold">Asante sana!</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your {formatKES(phase.amount)} has been added to this harambee.
            </p>
            {phase.receipt && (
              <p className="mt-1 text-[11px] text-muted-foreground">M-Pesa receipt {phase.receipt}</p>
            )}
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-full bg-foreground py-3.5 font-display text-sm font-bold text-background"
            >
              Done
            </button>
          </div>
        ) : phase.kind === "waiting" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Smartphone className="h-8 w-8" />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold">Check your phone</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Enter your M-Pesa PIN to send {formatKES(amount)} to {payoutName}.
            </p>
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for M-Pesa to confirm…
            </p>
          </div>
        ) : phase.kind === "failed" || phase.kind === "timeout" ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-flag-red/10 text-flag-red">
              <CircleAlert className="h-8 w-8" />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold">
              {phase.kind === "failed" ? "Payment not completed" : "Still waiting on M-Pesa"}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {phase.kind === "failed"
                ? phase.message
                : "We haven't heard back yet. If you entered your PIN and got an M-Pesa SMS, your donation will appear on this page shortly. Don't pay twice."}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border border-border py-3.5 font-display text-sm font-bold"
              >
                Close
              </button>
              <button
                onClick={() => setPhase({ kind: "form" })}
                className="flex-1 rounded-full bg-foreground py-3.5 font-display text-sm font-bold text-background"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Donate with M-Pesa</h3>
              <button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Payments go to <b className="text-foreground">{payoutName}</b>
            </p>

            <div className="mt-5">
              <label className="text-xs font-semibold text-muted-foreground">Amount (KES)</label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_MPESA_AMOUNT}
                value={amount || ""}
                onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 font-display text-xl font-bold outline-none focus:border-primary"
              />
              <div className="mt-2 flex gap-2">
                {quickAmounts.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAmount(a)}
                    className={
                      "flex-1 rounded-full py-2 text-xs font-semibold transition " +
                      (amount === a ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground")
                    }
                  >
                    {a.toLocaleString()}
                  </button>
                ))}
              </div>
              {amount > MAX_MPESA_AMOUNT && (
                <p className="mt-2 text-xs text-flag-red">
                  M-Pesa allows up to {formatKES(MAX_MPESA_AMOUNT)} per transaction.
                </p>
              )}
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold text-muted-foreground">M-Pesa number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="07XX XXX XXX"
                className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-primary"
              />
            </div>

            {!anonymous && (
              <div className="mt-4">
                <label className="text-xs font-semibold text-muted-foreground">Your name (shown to others)</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Brian K."
                  className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base outline-none focus:border-primary"
                />
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Give anonymously
            </label>

            {error && <p className="mt-3 text-sm text-flag-red">{error}</p>}

            <button
              onClick={confirm}
              disabled={busy || amount <= 0 || amount > MAX_MPESA_AMOUNT || phone.trim().length < 9}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-4 font-display text-base font-bold text-accent-foreground disabled:opacity-50"
            >
              <Smartphone className="h-4 w-4" />
              {phase.kind === "sending" ? "Sending prompt…" : `Send ${formatKES(amount || 0)} prompt`}
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              You'll get an M-Pesa prompt on your phone. Your PIN never touches Harambee.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
