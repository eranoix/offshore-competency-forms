import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode offline` produces one self-contained HTML file opened from a
// folder, so its links must be relative. The hosted build must use the root: a
// relative base makes /caap/ ask for /caap/assets/..., and the page comes up blank.
export default defineConfig(({ mode }) => {
  const offline = mode === "offline";
  return {
  base: offline ? "./" : "/",
  /* The company's forms are part of the app, not files beside it: imported,
     they are emitted with the rest on the site and carried inside the single
     file offshore, where fetch cannot reach a folder at all. */
  assetsInclude: ["**/*.docx", "**/*.pdf"],
  /* The offline copy has no worker, so the module that watches for a new
     version does not exist there. It resolves to a stand-in that watches for
     nothing, and the same source builds both ways. */
  resolve: offline
    ? { alias: { "virtual:pwa-register": "/src/engine/no-pwa.js" } }
    : {},
  define: { __OFFLINE__: JSON.stringify(offline) },
  build: offline
    ? { outDir: "dist-offline", assetsInlineLimit: 100_000_000, cssCodeSplit: false, reportCompressedSize: false }
    : { outDir: "dist" },
  plugins: [
    react(),
    ...(offline ? [viteSingleFile()] : []),
    ...(offline ? [] : [VitePWA({
      /* The app registers the worker itself and decides what happens when a
         new build is ready (see engine/updates.js) — which is that it is put
         in place and the page comes back on it, without asking. "prompt" here
         only means the plugin does not do that on its own. */
      registerType: "prompt",
      /* Written out in src/sw.js rather than generated: the generated one answers
         every navigation from its own cache, which stranded browsers on old builds. */
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectRegister: null,
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Offshore Report",
        short_name: "Offshore Report",
        description: "Small tools for people who work offshore.",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#0E2430",
        theme_color: "#0E2430",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      injectManifest: {
        /* Everything the page needs is precached, so it opens with no signal —
           the company's forms included. Left out of this list they are fetched
           over the network the first time a document is drawn, which on a
           vessel with no signal is never. */
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest,docx}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    })]),
  ],
  };
});
