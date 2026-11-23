<script lang="ts">
import { i18n } from "../i18n/i18n.svelte";
import { type UiActions, view } from "./view.svelte";

/** The sound switch (Phase 6.5, S3): a speaker beside the language button; off by default. */
let { actions }: { actions: UiActions } = $props();
</script>

<button
  id="sound"
  type="button"
  aria-pressed={view.sound}
  aria-label={i18n.t.music}
  title={i18n.t.music}
  onclick={() => actions.toggleSound()}
>
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {#if view.sound}
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    {:else}
      <path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    {/if}
  </svg>
</button>
