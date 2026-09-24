// Plain Vite + TanStack Start. This used to come from
// @lovable.dev/vite-tanstack-config, which bundled these plugins along with
// three that only matter inside Lovable's editor (a dev-server bridge, an HMR
// gate and a component tagger). Nobody running this copy is using that editor,
// so the wrapper is gone and the real plugins are listed here, where they can
// be read and changed.
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // Two copies of React, or of the router, breaks hooks and context in ways
    // that are miserable to debug. Pin them to one.
    dedupe: ["react", "react-dom", "@tanstack/react-router",
             "@tanstack/react-start", "@tanstack/react-query"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      devOptions: { enabled: false },
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Command Center",
        short_name: "Command",
        description: "Personal operating cockpit",
        theme_color: "#0a0d12",
        background_color: "#0a0d12",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // A new build must actually reach the browser. Without these three the
        // old worker stays in control, keeps serving month-old JS from
        // CacheFirst, and every deploy looks like it did nothing.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "html-nav", networkTimeoutSeconds: 4 },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              // Hashed filenames make a new build a new URL anyway, so a short
              // window costs nothing and bounds the damage when something does
              // go stale.
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
});
