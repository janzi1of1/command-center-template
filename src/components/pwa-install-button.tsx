import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { registerPwa } from "@/lib/pwa-register";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallButton() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    registerPwa();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => {
      setEvt(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!evt || hidden) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await evt.prompt();
          await evt.userChoice;
        } finally {
          setEvt(null);
        }
      }}
      className="fixed top-3 right-3 z-50 inline-flex items-center gap-1.5 rounded border border-[var(--color-primary)]/40 bg-[var(--card)]/90 px-2.5 py-1.5 text-[11px] font-medium tracking-wider text-[var(--color-primary)] backdrop-blur hover:bg-[var(--color-primary)]/10 mono uppercase"
      aria-label="Install app"
    >
      <Download className="h-3.5 w-3.5" />
      Install
    </button>
  );
}
