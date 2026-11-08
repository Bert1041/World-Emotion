<script lang="ts">
import { FixedStep, SPRING, Spring } from "@world-emotion/motion";
import BarRow from "./BarRow.svelte";
import { type UiActions, view } from "./view.svelte";

/**
 * Region card. Portrait screens: a bottom sheet that opens as a *peek* (name, mood, count) and
 * expands to the breakdown by a swipe up or the handle (decided 2026-11-07, phase-4-motion.md §2).
 * Landscape: the side card, always open. Motion is a compositor-only `translate` on a snappy spring
 * stepped by FixedStep; under reduced motion it jumps.
 */
let { actions }: { actions: UiActions } = $props();

/** Same query as SIDE_CARD in main.ts and the index.html media query. */
const side = matchMedia("(min-aspect-ratio: 6/5)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let wide = $state(side.matches);
$effect(() => {
  const on = () => (wide = side.matches);
  side.addEventListener("change", on);
  return () => side.removeEventListener("change", on);
});

// bind:this assigns null when the element goes away (the card closes), so the types say so.
let card: HTMLElement | null = $state(null);
let peekEnd: HTMLElement | null = $state(null);
let expanded = $state(false);
/** How far the card is pushed down (px); the hidden part sits below the screen edge. */
let offset = $state(0);
/** Collapsed offset: everything below the peek line (count) is out of view. */
let collapsedBy = $state(0);
/** True while the spring or a finger moves the card (exposed as data-moving for tests). */
let moving = $state(false);

const spring = new Spring(0, SPRING.snappy);
const stepper = new FixedStep();
let raf = 0;
let drag: {
  y0: number;
  off0: number;
  last: { y: number; t: number };
  v: number;
  /** Started on the handle: a tap there toggles; a drag moves the card like anywhere else. */
  onHandle: boolean;
} | null = null;

const targetOffset = () => (wide || expanded ? 0 : collapsedBy);

function settle(): void {
  moving = false;
  offset = spring.value;
  // main.ts re-measures the free area from the card's visible part and re-fits the map.
  actions.cardMoved();
}

function animateTo(target: number): void {
  spring.target = target;
  cancelAnimationFrame(raf);
  if (reduced) {
    spring.snap();
    settle();
    return;
  }
  moving = true;
  let prev = performance.now();
  const tick = (t: number) => {
    stepper.advance((t - prev) / 1000, (h) => spring.step(h));
    prev = t;
    offset = spring.value;
    if (spring.settled(0.5)) {
      spring.snap();
      settle();
    } else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Measure the peek line; re-run when the content or the screen changes. */
function measure(): void {
  if (card === null || peekEnd === null) return;
  const pad = Number.parseFloat(getComputedStyle(card).paddingBottom) || 0;
  collapsedBy = Math.max(0, card.offsetHeight - (peekEnd.offsetTop + peekEnd.offsetHeight + pad));
  if (drag === null) {
    spring.target = targetOffset();
    spring.snap();
    settle();
  }
}

// A new region opens collapsed; the same region updating its numbers keeps its state.
let openFor: string | null = null;
$effect(() => {
  const title = view.panel?.title ?? null;
  if (title !== openFor) {
    openFor = title;
    expanded = false;
  }
});

$effect(() => {
  if (card === null) return;
  const ro = new ResizeObserver(measure);
  ro.observe(card);
  return () => ro.disconnect();
});
$effect(() => {
  void wide;
  void expanded;
  if (drag === null) animateTo(targetOffset());
});

function toggle(): void {
  expanded = !expanded;
}

function down(e: PointerEvent): void {
  if (wide || card === null) return;
  card.setPointerCapture(e.pointerId);
  cancelAnimationFrame(raf);
  moving = true;
  const onHandle = e.target instanceof Element && e.target.closest("#panel-handle") !== null;
  drag = { y0: e.clientY, off0: offset, last: { y: e.clientY, t: e.timeStamp }, v: 0, onHandle };
}
function move(e: PointerEvent): void {
  if (drag === null) return;
  const raw = drag.off0 + (e.clientY - drag.y0);
  // Rubber band past either end, so the sheet feels attached, not clamped.
  const lo = 0;
  const hi = collapsedBy;
  offset = raw < lo ? lo - Math.sqrt(lo - raw) * 3 : raw > hi ? hi + Math.sqrt(raw - hi) * 3 : raw;
  const dt = Math.max(16, e.timeStamp - drag.last.t);
  drag.v = ((e.clientY - drag.last.y) / dt) * 1000;
  drag.last = { y: e.clientY, t: e.timeStamp };
}
function up(e: PointerEvent): void {
  if (drag === null) return;
  const moved = Math.abs(e.clientY - drag.y0);
  const v = e.timeStamp - drag.last.t < 100 ? drag.v : 0;
  const onHandle = drag.onHandle;
  drag = null;
  spring.value = offset;
  spring.velocity = 0;
  if (moved < 6) {
    if (onHandle) toggle();
    else animateTo(targetOffset()); // a tap on the card body changes nothing
    return;
  }
  // A flick decides by direction; a slow drag by which state is nearer.
  const next = Math.abs(v) > 400 ? v < 0 : offset < collapsedBy / 2;
  if (next === expanded) animateTo(targetOffset());
  else expanded = next;
}
</script>

<section
  id="panel"
  aria-labelledby="panel-title"
  bind:this={card}
  hidden={view.panel === null}
  aria-live="polite"
  data-peek-offset={wide ? 0 : Math.max(0, Math.round(offset))}
  data-moving={moving}
  style:translate={offset === 0 ? null : `0 ${offset}px`}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  {#if view.panel}
    {#if !wide && collapsedBy > 0}
      <button
        id="panel-handle"
        type="button"
        aria-expanded={expanded}
        aria-controls="bars"
        aria-label={expanded ? "Hide the breakdown" : "Show the breakdown"}
        onclick={(e) => {
          // Pointer taps toggle in up() (the card holds the pointer, so a tap is part of the drag);
          // keyboard and assistive tech click with detail 0.
          if (e.detail === 0) toggle();
        }}
      ></button>
    {/if}
    <div class="kicker">Right now</div>
    <h2 id="panel-title">{view.panel.title}</h2>
    <div id="panel-mood">
      {#if view.panel.mood}feels <span style:color={view.panel.mood.color}>{view.panel.mood.name}</span>{/if}
    </div>
    <div id="panel-sub" bind:this={peekEnd}>{view.panel.sub}</div>
    <!-- Fades with the slide: collapsed, the strip below the peek line shows no half-cut bars. -->
    <ul id="bars" style:opacity={collapsedBy > 0 ? Math.max(0, 1 - offset / collapsedBy) : null}>
      {#each view.panel.bars as bar (bar.name)}
        <BarRow {bar} />
      {/each}
    </ul>
  {/if}
</section>
