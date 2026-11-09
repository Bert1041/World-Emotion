import { subsolarPoint } from "@world-emotion/motion";
import { geoContains, geoDistance, geoRotation } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  antipode,
  NIGHT_FULL,
  NIGHT_STEP_ALPHA,
  NIGHT_STEPS,
  nightDepth,
  nightShapes,
} from "./night";

const deg = (a: readonly [number, number], b: readonly [number, number]) =>
  (geoDistance([a[0], a[1]], [b[0], b[1]]) * 180) / Math.PI;

describe("antipode", () => {
  it.each([
    [
      [0, 0],
      [180, 0],
    ],
    [
      [10, 20],
      [-170, -20],
    ],
    [
      [-10, -20],
      [170, 20],
    ],
    [
      [180, 5],
      [0, -5],
    ],
    [
      [-180, 5],
      [0, -5],
    ],
  ] as const)("%j → %j", (p, q) => {
    const a = antipode(p);
    expect(a[0]).toBeCloseTo(q[0], 9);
    expect(a[1]).toBeCloseTo(q[1], 9);
    expect(deg(p, a)).toBeCloseTo(180, 6);
  });
});

describe("night shading", () => {
  // The March 2026 equinox at 12:00 UTC: the sun is over the Gulf of Guinea, night over the Pacific.
  const sun = subsolarPoint(Date.UTC(2026, 2, 20, 12));

  it("is centred opposite the sun", () => {
    expect(deg(sun, [0, 0])).toBeLessThan(2);
    expect(nightDepth(sun, sun), "under the sun").toBe(0);
    expect(nightDepth(antipode(sun), sun), "opposite the sun").toBe(NIGHT_STEPS.length);
  });

  it.each([
    // [degrees from the sub-solar point, steps of shading]
    [60, 0], // afternoon
    [89.9, 0], // sun just above the horizon: still day
    [90.5, 1], // just after sunset: the faintest step only
    [99, 6], // mid twilight: about half (radii 90 … 82.5 cover a point 81° from the anti-sun)
    [108.5, NIGHT_STEPS.length], // twilight over
    [150, NIGHT_STEPS.length], // full night
  ])("%s° from the sun → depth %s", (d, depth) => {
    // A point exactly d degrees east of the sun (rotate the sun to [0, 0], step d along its equator).
    const p = geoRotation([-sun[0], -sun[1]]).invert([d, 0]) as [number, number];
    expect(Math.abs(deg(p, sun) - d)).toBeLessThan(1e-6);
    expect(nightDepth(p, sun)).toBe(depth);
  });

  it("steps span twilight (90° → 72°), evenly, and stack to the full shade", () => {
    expect(NIGHT_STEPS[0]).toBe(90);
    expect(NIGHT_STEPS.at(-1)).toBeCloseTo(72, 9);
    const gaps = NIGHT_STEPS.slice(1).map((r, i) => (NIGHT_STEPS[i] as number) - r);
    for (const g of gaps) expect(g).toBeCloseTo(1.5, 9);
    expect(1 - (1 - NIGHT_STEP_ALPHA) ** NIGHT_STEPS.length).toBeCloseTo(NIGHT_FULL, 9);
    // Each step is a small change (under 5 of 255 levels on the brightest land), 1.5° apart, so
    // the stack reads as a gradient; four 9% steps were ~14 levels each and showed as stripes.
    expect(NIGHT_STEP_ALPHA * 255 * 0.6).toBeLessThan(5);
  });

  it("the drawn shapes agree with the oracle (inside means darker), all four, both sides", () => {
    const shapes = nightShapes(sun);
    expect(shapes).toHaveLength(NIGHT_STEPS.length);
    // A grid over the whole sphere, away from each step's edge (the drawn edge is a polygon).
    for (let lon = -175; lon <= 175; lon += 10) {
      for (let lat = -85; lat <= 85; lat += 10) {
        const p: [number, number] = [lon, lat];
        const d = deg(p, antipode(sun));
        shapes.forEach((shape, i) => {
          const r = NIGHT_STEPS[i] as number;
          if (Math.abs(d - r) < 0.5) return;
          expect(geoContains(shape, p), `${p} step ${r}°`).toBe(d < r);
        });
      }
    }
  });
});
