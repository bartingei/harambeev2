import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { type Category } from "@/lib/campaigns";
import { createCampaign } from "@/lib/campaigns.functions";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Heart, GraduationCap, Users, Sparkles, CalendarDays, Infinity } from "lucide-react";
import { useRef, useState } from "react";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({
    meta: [
      { title: "Start a Harambee — Harambee" },
      { name: "description", content: "Create a campaign, set your goal and rally your people around a cause that matters." },
      { property: "og:title", content: "Start a Harambee" },
      { property: "og:description", content: "Create a campaign, set your goal and rally your people around a cause that matters." },
    ],
  }),
  component: CreateCampaign,
});

const categories: { id: Category; label: string; icon: React.ReactNode }[] = [
  { id: "medical", label: "Medical", icon: <Heart className="h-4 w-4" /> },
  { id: "education", label: "Education", icon: <GraduationCap className="h-4 w-4" /> },
  { id: "community", label: "Community", icon: <Users className="h-4 w-4" /> },
  { id: "other", label: "Other", icon: <Sparkles className="h-4 w-4" /> },
];

type Duration = "30" | "60" | "90" | "custom" | "none";

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function CreateCampaign() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const create = useServerFn(createCampaign);

  const [title, setTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [story, setStory] = useState("");
  const [goal, setGoal] = useState<number>(50000);
  const [category, setCategory] = useState<Category>("community");
  const [duration, setDuration] = useState<Duration>("30");
  const [customDeadline, setCustomDeadline] = useState(addDays(30));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const valid = title.trim().length > 3 && story.trim() && goal > 0 && file;

  const handleFile = (f?: File) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !file) return;
    setBusy(true);
    setError("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Please sign in again.");

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("campaign-photos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const result = await create({
        data: {
          title: title.trim(),
          story: story.trim(),
          goalAmount: goal,
          category,
          coverPhoto: path,
          organizerName: organizer.trim(),
          deadline:
            duration === "none"
              ? null
              : duration === "custom"
                ? customDeadline
                : addDays(Number(duration)),
        },
      });
      navigate({ to: "/share/$id", params: { id: result.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't publish your campaign. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="app-shell pb-12">
      <AppHeader back />
      <div className="px-5 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-flag-red">New harambee</p>
        <h1 className="mt-1 font-display text-2xl font-bold leading-tight">Tell us your story.</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Be honest, be specific. Trust is everything.</p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5 px-5">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Campaign photo</label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-1 flex aspect-[5/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-card transition hover:border-primary"
          >
            {preview ? (
              <img src={preview} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <div className="text-center">
                <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">Tap to upload</p>
                <p className="text-xs text-muted-foreground">A clear photo builds trust</p>
              </div>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Campaign duration</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["30", "60", "90"] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setDuration(days)}
                className={
                  "rounded-xl border px-2 py-3 text-sm font-semibold transition " +
                  (duration === days
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground")
                }
              >
                {days} days
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDuration("custom")}
              className={
                "col-span-2 flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition " +
                (duration === "custom"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground")
              }
            >
              <CalendarDays className="h-4 w-4" /> Custom date
            </button>
            <button
              type="button"
              onClick={() => setDuration("none")}
              className={
                "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-semibold transition " +
                (duration === "none"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground")
              }
            >
              <Infinity className="h-4 w-4" /> No deadline
            </button>
          </div>
          {duration === "custom" && (
            <input
              type="date"
              min={addDays(1)}
              value={customDeadline}
              onChange={(e) => setCustomDeadline(e.target.value)}
              className="input mt-2"
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {duration === "none"
              ? "This campaign runs until you close it."
              : "30 days is selected by default. You can extend an expired campaign within 48 hours."}
          </p>
        </div>

        <Field label="Campaign title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Help mama Njeri pay school fees"
            className="input"
          />
        </Field>

        <Field label="Your name">
          <input
            value={organizer}
            onChange={(e) => setOrganizer(e.target.value)}
            placeholder="Who's organizing this harambee?"
            className="input"
          />
        </Field>

        <Field label="Your story">
          <textarea
            value={story}
            onChange={(e) => setStory(e.target.value)}
            rows={6}
            placeholder="What is this for? How will the funds be used? Speak from the heart."
            className="input resize-none leading-relaxed"
          />
        </Field>

        <Field label="Goal amount (KES)">
          <input
            type="number"
            inputMode="numeric"
            value={goal || ""}
            onChange={(e) => setGoal(parseInt(e.target.value) || 0)}
            className="input font-display text-xl font-bold"
          />
        </Field>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Category</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {categories.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={
                    "flex items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-foreground/30")
                  }
                >
                  {c.icon}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-sm text-flag-red">{error}</p>}

        <button
          type="submit"
          disabled={!valid || busy}
          className="mt-2 w-full rounded-full bg-accent py-4 font-display text-base font-bold text-accent-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Publishing…" : "Launch Harambee"}
        </button>
      </form>

      <style>{`
        .input {
          width: 100%;
          margin-top: 0.25rem;
          border-radius: 0.875rem;
          border: 1px solid var(--input);
          background: var(--background);
          padding: 0.75rem 1rem;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .input:focus { border-color: var(--primary); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
