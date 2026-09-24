// Guarded service worker registration. Only registers in production on the
// real published origin — never in a preview, iframe, or dev.

const SW_PATH = "/sw.js";

function shouldSkip(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }
  const { hostname } = window.location;
  if (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  ) {
    return true;
  }
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterMatching() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs.map((r) => {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith(SW_PATH)) return r.unregister();
      return Promise.resolve(false);
    }),
  );
}

export async function registerPwa() {
  // DISABLED 2026-09-17. This is a live dashboard: every panel reads from
  // Supabase and is worthless offline, so the only thing the service worker
  // ever did here was serve stale JavaScript after a deploy. It cost three
  // separate debugging rounds - a wiped board that still showed data, replies
  // that had already been sent, and a clock stuck on UTC - each time with the
  // fix live on the server and invisible in the browser.
  //
  // We do not just stop registering: any worker already installed on a phone
  // or laptop would keep serving its cache forever. Unregister it on load.
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await unregisterMatching();
    const caches_ = (globalThis as any).caches;
    if (caches_?.keys) {
      const keys: string[] = await caches_.keys();
      await Promise.all(keys.map((k) => caches_.delete(k)));
    }
  } catch (err) {
    console.warn("[pwa] could not unregister", err);
  }
}
