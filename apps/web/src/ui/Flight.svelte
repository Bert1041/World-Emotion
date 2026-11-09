<script lang="ts">
import { DURATION, easeInOutCubic, FixedStep, SPRING, Spring } from "@world-emotion/motion";
import Face from "./Face.svelte";
import { type Flight, type UiActions } from "./view.svelte";

/**
 * The check-in face (README §8.2.5): pops on a bouncy spring where you tapped it, then arcs onto
 * your country and shrinks as it lands. Transform and opacity only (compositor). Decorative.
 */
let { flight, actions }: { flight: Flight; actions: UiActions } = $props();
const POP = 0.35; // seconds of pop before it leaves

let x = $state(0);
let y = $state(0);
let scale = $state(1);

$effect(() => {
  const f = flight;
  const spring = new Spring(0.55, SPRING.bouncy);
  spring.target = 1;
  const stepper = new FixedStep();
  let t = 0;
  let prev = performance.now();
  let raf = 0;
  x = f.from.x;
  y = f.from.y;
  const tick = (now: number) => {
    const dt = (now - prev) / 1000;
    prev = now;
    t += dt;
    stepper.advance(dt, (h) => spring.step(h));
    if (t < POP) {
      scale = spring.value * 1.15;
    } else {
      const p = Math.min(1, (t - POP) / DURATION.flight);
      const e = easeInOutCubic(p);
      x = f.from.x + (f.to.x - f.from.x) * e;
      // An arc: rises first, then drops onto the country.
      y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * e) * 120;
      scale = 1.15 * (1 - 0.6 * e);
      if (p >= 1) {
        actions.landed(f.id);
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
});
</script>

<div class="flight" aria-hidden="true" style:translate="{x}px {y}px" style:scale={scale}>
  <Face mood={flight.mood} size={44} />
</div>
