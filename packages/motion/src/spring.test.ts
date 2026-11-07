import { describe, expect, it } from "vitest";
import { Spring } from "./spring";
import { STEP } from "./step";
import { SPRING } from "./tokens";

const simulate = (s: Spring, seconds: number, each?: (t: number) => void) => {
  const n = Math.round(seconds / STEP);
  for (let i = 1; i <= n; i++) {
    s.step(STEP);
    each?.(i * STEP);
  }
};

describe("Spring", () => {
  it("tracks the exact critically damped solution", () => {
    // x(t) = (1 + ωt) e^(−ωt) from x0 = 1, v0 = 0, target 0.
    const { omega } = SPRING.gentle;
    const s = new Spring(1, SPRING.gentle);
    s.target = 0;
    let worst = 0;
    simulate(s, 1.5, (t) => {
      worst = Math.max(worst, Math.abs(s.value - (1 + omega * t) * Math.exp(-omega * t)));
    });
    expect(worst).toBeLessThan(0.02); // measured 1.2%: first-order method at 240 Hz
  });

  it("critically damped presets never overshoot", () => {
    for (const cfg of [SPRING.snappy, SPRING.gentle]) {
      const s = new Spring(0, cfg);
      s.target = 1;
      let max = 0;
      simulate(s, 3, () => {
        max = Math.max(max, s.value);
      });
      expect(max).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("bouncy overshoots once, visibly, then settles", () => {
    const s = new Spring(0, SPRING.bouncy);
    s.target = 1;
    let max = 0;
    simulate(s, 3, () => {
      max = Math.max(max, s.value);
    });
    expect(max).toBeGreaterThan(1.1);
    expect(max).toBeLessThan(1.4);
    expect(s.settled()).toBe(true);
  });

  it("every preset settles within its intended time", () => {
    const budget = { snappy: 0.5, gentle: 1.2, bouncy: 1.2 } as const;
    for (const [name, cfg] of Object.entries(SPRING) as [
      keyof typeof SPRING,
      typeof SPRING.snappy,
    ][]) {
      const s = new Spring(0, cfg);
      s.target = 1;
      let settledAt = Number.POSITIVE_INFINITY;
      simulate(s, 3, (t) => {
        if (s.settled(1e-2) && settledAt === Number.POSITIVE_INFINITY) settledAt = t;
        if (!s.settled(1e-2)) settledAt = Number.POSITIVE_INFINITY; // must stay settled
      });
      expect(settledAt, name).toBeLessThan(budget[name]);
    }
  });

  it("snap jumps to the target and stops", () => {
    const s = new Spring(0, SPRING.bouncy);
    s.target = 5;
    s.step(STEP);
    s.snap();
    expect([s.value, s.velocity]).toEqual([5, 0]);
  });
});
