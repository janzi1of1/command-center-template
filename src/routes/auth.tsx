import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Satellite } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ACCESS // Command Center" },
      { name: "description", content: "Authenticate to enter your Command Center." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  if (!mounted) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        toast.success("Check your inbox to verify your email before signing in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Reset link transmitted. Check your inbox.");
        setMode("signin");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Auth failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin" ? "ENGAGE" : mode === "signup" ? "REGISTER OPERATOR" : "TRANSMIT RESET LINK";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background hud-grid px-4">
      <div className="w-full max-w-sm border border-border bg-card rounded-sm p-6 relative">
        <div className="absolute -top-px left-4 right-4 h-px bg-primary/60 shadow-[0_0_10px] shadow-primary" />
        <div className="flex items-center gap-2 mb-6">
          <div className="size-9 border border-primary/60 bg-primary/10 rounded-sm flex items-center justify-center">
            <Satellite className="size-4 text-primary" />
          </div>
          <div>
            <div className="mono text-sm tracking-widest text-primary">COMMAND CENTER</div>
            <div className="mono text-[10px] text-muted-foreground">
              {mode === "forgot" ? "PASSWORD RECOVERY" : "SECURE ACCESS REQUIRED"}
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mono text-[10px] text-muted-foreground tracking-wider">OPERATOR ID</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mt-1 bg-background border border-border rounded-sm px-3 py-2 text-sm mono focus:outline-none focus:border-primary"
              placeholder="you@domain.com"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <label className="mono text-[10px] text-muted-foreground tracking-wider">AUTH KEY</label>
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
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full mono text-xs tracking-widest bg-primary text-primary-foreground py-2.5 rounded-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "TRANSMITTING…" : title}
          </button>
        </form>

        <div className="mt-4 space-y-2">
          {mode === "signin" && (
            <>
              <button
                onClick={() => setMode("forgot")}
                className="w-full mono text-[10px] tracking-wider text-muted-foreground hover:text-primary"
              >
                » FORGOT AUTH KEY?
              </button>
              <button
                onClick={() => setMode("signup")}
                className="w-full mono text-[10px] tracking-wider text-muted-foreground hover:text-primary"
              >
                » NEW OPERATOR? REGISTER
              </button>
            </>
          )}
          {mode === "signup" && (
            <button
              onClick={() => setMode("signin")}
              className="w-full mono text-[10px] tracking-wider text-muted-foreground hover:text-primary"
            >
              » EXISTING OPERATOR? SIGN IN
            </button>
          )}
          {mode === "forgot" && (
            <button
              onClick={() => setMode("signin")}
              className="w-full mono text-[10px] tracking-wider text-muted-foreground hover:text-primary"
            >
              ← BACK TO SIGN IN
            </button>
          )}
        </div>
        <div className="mt-4 text-center">
          <Link to="/" className="mono text-[10px] text-muted-foreground hover:text-primary">
            ← RETURN
          </Link>
        </div>
      </div>
    </div>
  );
}
