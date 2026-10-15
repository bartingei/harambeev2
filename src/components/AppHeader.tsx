import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function AppHeader({ title, back }: { title?: string; back?: boolean }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/60 bg-background/85 px-5 py-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        {back ? (
          <Link
            to="/"
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-secondary"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </Link>
        ) : (
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <span className="font-display text-base font-bold">H</span>
            </span>
            <span className="font-display text-lg font-bold tracking-tight">Harambee</span>
          </Link>
        )}
        {title && <h1 className="font-display text-base font-semibold">{title}</h1>}
      </div>

      {!back && !loading && (
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="rounded-full px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Dashboard
              </Link>
              <button
                onClick={signOut}
                className="rounded-full px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="rounded-full px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
          )}
          <Link
            to="/create"
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-xs font-semibold text-background transition-transform active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            Start
          </Link>
        </div>
      )}
    </header>
  );
}
