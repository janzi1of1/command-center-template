import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "RESET // Command Center" },
      { name: "description", content: "Set a new auth key for your Command Center." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Supabase JS auto-exchanges the recovery code in the URL and emits
    // a PASSWORD_RECOVERY event. We also accept an existing session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!mounted) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Auth keys do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Auth key updated. Welcome back, operator.");
      navigate({ to: "/" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background hud-grid px-4">
      <div className="w-full max-w-sm border border-border bg-card rounded-sm p-6 relative">
        <div className="absolute -top-px left-4 right-4 h-px bg-primary/60 shadow-[0_0_10px] shadow-primary" />
        <div className="flex items-center gap-2 mb-6">
          <div className="size-9 border border-primary/60 bg-primary/10 rounded-sm flex items-center justify-center">
            <KeyRound className="size-4 text-primary" />
          </div>
          <div>
            <div className="mono text-sm tracking-widest text-primary">RESET AUTH KEY</div>
            <div className="mono text-[10px] text-muted-foreground">
              {ready ? "ENTER NEW CREDENTIALS" : "VALIDATING RECOVERY LINK…"}
            </div>
          </div>
        </div>

        {ready ? (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mono text-[10px] text-muted-foreground tracking-wider">NEW AUTH KEY</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-1 bg-background border border-border rounded-sm px-3 py-2 text-sm mono focus:outline-none focus:border-primary"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="mono text-[10px] text-muted-foreground tracking-wider">CONFIRM</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full mt-1 bg-background border border-border rounded-sm px-3 py-2 text-sm mono focus:outline-none focus:border-primary"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full mono text-xs tracking-widest bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "UPDATING…" : "UPDATE AUTH KEY"}
            </button>
          </form>
        ) : (
          <p className="mono text-[11px] text-muted-foreground">
            If this page does not unlock, the recovery link may have expired. Request a new one from the
            sign-in screen.
          </p>
        )}

        <div className="mt-4 text-center">
          <Link to="/auth" className="mono text-[10px] text-muted-foreground hover:text-primary">
            ← BACK TO SIGN IN
          </Link>
        </div>
      </div>
    </div>
  );
}
