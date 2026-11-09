import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** TypeScript in <script lang="ts"> is stripped by Vite's own transform. */
export default { preprocess: vitePreprocess() };
