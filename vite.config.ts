import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    // The bundle is packaged into the desktop binary and loaded from local disk, never
    // over a network, so the default 500 kB network-transfer warning doesn't apply.
    chunkSizeWarningLimit: 2000,
  },
});
