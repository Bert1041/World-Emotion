/**
 * Fixed-step integration (README §8.1): physics always advances in identical steps, so a spring
 * behaves the same on 60 Hz, 120 Hz and irregular frames. Rendering reads the latest state.
 */

/** 240 Hz: a whole number of steps per frame at 60 Hz (4) and 120 Hz (2). */
export const STEP = 1 / 240;
/** Catch-up cap (0.1 s). After a longer stall (tab switch, GC) the backlog is dropped, not replayed. */
export const MAX_STEPS = 24;
/** Float slack: 1/60 is 4 × (1/240) in exact maths but not always in binary. */
const EPS = 1e-9;

export class FixedStep {
  private acc = 0;

  constructor(
    readonly step = STEP,
    readonly maxSteps = MAX_STEPS,
  ) {}

  /**
   * Add `dt` seconds of frame time and call `update(step)` once per whole step owed.
   * Returns how many steps ran.
   */
  advance(dt: number, update: (h: number) => void): number {
    if (!(dt > 0)) return 0; // negative, zero or NaN: nothing to do
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.step - EPS && n < this.maxSteps) {
      update(this.step);
      this.acc -= this.step;
      n++;
    }
    if (this.acc >= this.step - EPS) this.acc = 0; // stalled: drop the backlog
    if (this.acc < 0) this.acc = 0; // absorbed float slack
    return n;
  }

  /** Forget any partial step (e.g. when an animation is replaced). */
  reset(): void {
    this.acc = 0;
  }
}
