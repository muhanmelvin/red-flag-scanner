import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// BASE_PATH lets the same build serve from a sub-path (GitHub Pages:
// /red-flag-scanner/) or from the root (Cloudflare Pages, custom domain).
// SINGLE_FILE=1 inlines everything into one index.html — the "download and
// open offline" distribution, and what gets pasted into a claude.ai artifact.
const single = process.env.SINGLE_FILE === "1";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: single ? [viteSingleFile()] : [],
  build: {
    outDir: single ? "dist-single" : "dist",
    target: "es2020",
    sourcemap: false,
    assetsInlineLimit: single ? 100_000_000 : 4096,
  },
  server: { port: 5173 },
});
