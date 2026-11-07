import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: { target: "es2022", sourcemap: true },
  preview: { host: "127.0.0.1" },
  server: { host: "127.0.0.1" },
});
