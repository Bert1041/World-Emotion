<script lang="ts">
import { DURATION, easeOut } from "@world-emotion/motion";
import { untrack } from "svelte";
import { i18n } from "../i18n/i18n.svelte";

/** A number that ticks to its new value (README §8.2.5 "counters tick up"); instant under reduced
 * motion. Tabular figures so the width does not jitter while it counts. */
let { value }: { value: number } = $props();
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Starts at the first value; later changes animate in the effect below.
let shown = $state(untrack(() => value));
let raf = 0;
$effect(() => {
  const to = value;
  // Untracked: the effect depends on `value` only. Tracking `shown` would restart it every tick.
  const from = untrack(() => shown);
  cancelAnimationFrame(raf);
  if (reduced || from === to) {
    shown = to;
    return;
  }
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / 1000 / DURATION.slow);
    shown = Math.round(from + (to - from) * easeOut(p));
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
});
</script>

<!-- The chosen language's digits, not the browser's (a German browser showed "28.378" in French). -->
<span class="count" data-value={value}>{i18n.fmt.n(shown)}</span>
