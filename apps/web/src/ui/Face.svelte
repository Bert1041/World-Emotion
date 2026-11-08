<script lang="ts">
import { MOOD_COLORS } from "../engine/palette";

/** A mood face: drawn, not emoji, so it looks the same on every platform. Decorative: the mood
 * is always named in text next to it (never colour or face alone). */
let { mood, size = 40 }: { mood: number; size?: number } = $props();

// Per mood: eyes (left, right path), brows (optional), mouth.
const FEATURES: readonly { eyes: string; brows?: string; mouth: string }[] = [
  /* happy */ { eyes: "M14 17a2 2 0 1 0 0.01 0M26 17a2 2 0 1 0 0.01 0", mouth: "M12 24q8 8 16 0" },
  /* calm */ { eyes: "M11 18q3 2 6 0M23 18q3 2 6 0", mouth: "M14 26q6 3 12 0" },
  /* excited */ {
    eyes: "M14 16a2.6 2.6 0 1 0 0.01 0M26 16a2.6 2.6 0 1 0 0.01 0",
    mouth: "M14 24h12q0 7 -6 7t-6 -7z",
  },
  /* stressed */ {
    eyes: "M14 17a2 2 0 1 0 0.01 0M26 17a2 2 0 1 0 0.01 0",
    brows: "M10 12l7 2M30 12l-7 2",
    mouth: "M12 27q2 -3 4 0t4 0t4 0t4 0",
  },
  /* sad */ {
    eyes: "M14 18a2 2 0 1 0 0.01 0M26 18a2 2 0 1 0 0.01 0",
    brows: "M10 14l6 -2M30 14l-6 -2",
    mouth: "M13 29q7 -6 14 0",
  },
  /* angry */ {
    eyes: "M14 18a2 2 0 1 0 0.01 0M26 18a2 2 0 1 0 0.01 0",
    brows: "M10 12l7 4M30 12l-7 4",
    mouth: "M13 28q7 -4 14 0",
  },
];
const f = $derived(FEATURES[mood] ?? FEATURES[0]);
</script>

<svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <circle cx="20" cy="20" r="18" fill={MOOD_COLORS[mood]} />
  <g fill="none" stroke="#14161c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d={f?.eyes} fill="#14161c" />
    {#if f?.brows}<path d={f.brows} />{/if}
    <path d={f?.mouth} />
  </g>
</svg>
