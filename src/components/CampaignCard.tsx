import { Link } from "@tanstack/react-router";
import { ProgressBar } from "./ProgressBar";
import { categoryLabel, formatKES, type Campaign } from "@/lib/campaigns";
import { Clock } from "lucide-react";

export function CampaignCard({ c }: { c: Campaign }) {
  const pct = Math.min(100, Math.round((c.raised / c.goal) * 100));
  return (
    <Link
      to="/campaign/$id"
      params={{ id: c.id }}
      className="group block overflow-hidden rounded-3xl bg-card transition-transform active:scale-[0.99]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="relative aspect-[5/3] overflow-hidden">
        <img
          src={c.image}
          alt={c.title}
          loading="lazy"
          width={1024}
          height={614}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute left-3 top-3 chip bg-background/90 text-foreground backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-flag-red" />
          {categoryLabel[c.category]}
        </div>
        <div className="absolute right-3 top-3 chip bg-flag-black/80 text-cream backdrop-blur">
          <Clock className="h-3 w-3" /> {c.deadline ? `${c.daysLeft}d left` : "No deadline"}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="font-display text-base font-bold leading-snug text-foreground">
            {c.title}
          </h3>
          <div className="mt-2 flex items-center gap-2">
            {c.organizerPhoto ? (
              <img
                src={c.organizerPhoto}
                alt={c.organizer}
                loading="lazy"
                width={64}
                height={64}
                className="h-7 w-7 rounded-full object-cover"
                suppressHydrationWarning
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 font-display text-xs font-bold text-primary">
                {c.organizer.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="text-xs text-muted-foreground">by {c.organizer}</p>
          </div>
        </div>
        {c.latestUpdate && (
          <div className="rounded-2xl bg-secondary px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Latest update · {c.latestUpdate.when}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-foreground/80">
              {c.latestUpdate.content}
            </p>
          </div>
        )}
        <ProgressBar raised={c.raised} goal={c.goal} />
        <div className="flex items-end justify-between">
          <div>
            <p className="font-display text-lg font-bold text-primary">
              {formatKES(c.raised)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              raised of {formatKES(c.goal)} · {pct}%
            </p>
          </div>
          <span className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground">
            Donate
          </span>
        </div>
      </div>
    </Link>
  );
}
