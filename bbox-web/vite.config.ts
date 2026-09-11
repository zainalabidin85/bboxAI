import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation (COOP/COEP) headers below enable SharedArrayBuffer,
// which liveInference.ts's multi-threaded WASM fallback path (ort.env.wasm.numThreads)
// relies on. Production (bboxai-remote nginx) needs the matching headers set
// as a deployment-time server config change — out of scope for this repo;
// this only covers local `npm run dev` / `npm run preview` parity.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
