<script lang="ts">
import type { Bar } from "./view.svelte";

let { bar }: { bar: Bar } = $props();
let fill: HTMLElement | undefined = $state();
let grown = $state(false);

// Bars fill from empty when they appear (README §8.2.6), then flow between values. The start
// value must be styled before the change, or the browser skips the transition: read it first.
$effect(() => {
  if (fill === undefined || grown) return;
  void getComputedStyle(fill).transform;
  grown = true;
});
</script>

<li class:lead={bar.lead}>
  <span class="label">{bar.name}</span>
  <span class="track">
    <!-- Compositor-only (README §8.1 layer 4): scaleX, never width. -->
    <span
      class="fill"
      bind:this={fill}
      style:background={bar.color}
      style:transform="scaleX({grown ? bar.share.toFixed(3) : 0})"
    ></span>
  </span>
  <span class="pct">{bar.pct}%</span>
</li>
