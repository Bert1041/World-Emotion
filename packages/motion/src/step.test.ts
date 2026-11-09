import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Spring } from "./spring";
import { FixedStep, MAX_STEPS, STEP } from "./step";
import { SPRING } from "./tokens";

/** Run a spring from 0 → 1 with the given frame times; sample after each frame. */
function run(frames: readonly number[]): { t: number; value: number }[] {
  const stepper = new FixedStep();
  const s = new Spring(0, SPRING.bouncy);
  s.target = 1;
  let t = 0;
  const out: { t: number; value: number }[] = [];
  for (const dt of frames) {
    stepper.advance(dt, (h) => s.step(h));
    t += dt;
    out.push({ t, value: s.value });
  }
  return out;
}

const at = (samples: { t: number; value: number }[], t: number) =>
  samples.find((x) => Math.abs(x.t - t) < 1e-9)?.value;

describe("FixedStep", () => {
  it("same spring trajectory at 60 Hz and 120 Hz (README §8.6 frame-rate honesty)", () => {
    const a = run(Array(120).fill(1 / 60)); // 2 s at 60 Hz
    const b = run(Array(240).fill(1 / 120)); // 2 s at 120 Hz
    for (const t of [1 / 60, 0.1, 0.25, 0.5, 1, 2]) {
      const va = at(a, t);
      const vb = at(b, t);
      expect(va, `60 Hz sample at ${t}`).toBeDefined();
      expect(Math.abs((va as number) - (vb as number)), `t=${t}`).toBeLessThan(1e-9);
    }
    // The bouncy preset must actually move and overshoot, or the comparison proves nothing.
    expect(Math.max(...a.map((x) => x.value))).toBeGreaterThan(1.05);
  });

  it("runs exactly floor(total / STEP) steps for any frame times (irregular frames)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.001, max: 0.05, noNaN: true }), {
          minLength: 1,
          maxLength: 200,
        }),
        (frames) => {
          const s = new FixedStep();
          let steps = 0;
          let total = 0;
          for (const dt of frames) {
            steps += s.advance(dt, () => {});
            total += dt;
          }
          // ±1 at an exact step boundary, where float slack decides.
          expect(Math.abs(steps - Math.floor(total / STEP + 1e-6))).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it("caps catch-up after a stall and drops the backlog", () => {
    const s = new FixedStep();
    expect(s.advance(5, () => {})).toBe(MAX_STEPS); // a 5 s stall: 24 steps, not 1200
    expect(s.advance(STEP / 2, () => {})).toBe(0); // backlog gone, not replayed
  });

  it("ignores zero, negative and NaN frame times", () => {
    const s = new FixedStep();
    for (const dt of [0, -1, Number.NaN]) expect(s.advance(dt, () => {})).toBe(0);
    expect(s.advance(STEP, () => {})).toBe(1);
  });
});
