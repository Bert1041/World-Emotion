import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { blend, smoothingAlpha } from "./smooth";
import { sum } from "./test-fixtures";

describe("smoothingAlpha", () => {
  it("is 0.5 after exactly one half-life", () =>
    expect(smoothingAlpha(180, 180)).toBeCloseTo(0.5, 12));
  it("matches the README's ~0.7 at the 5-minute launch cadence", () =>
    expect(smoothingAlpha(300, 180)).toBeCloseTo(0.685, 3));
  it("approaches 1 after a long outage", () =>
    expect(smoothingAlpha(6 * 3600, 180)).toBeGreaterThan(0.999999));
  it.each([0, -60, Number.NaN])("rejects dt = %s", (dt) => {
    expect(() => smoothingAlpha(dt, 180)).toThrow(RangeError);
  });
  it("rejects a non-positive half-life", () =>
    expect(() => smoothingAlpha(60, 0)).toThrow(RangeError));
});

describe("blend", () => {
  it("feels the same at any cadence: two 150 s steps equal one 300 s step", () => {
    // README G3: the reason smoothing is defined by half-life, not a per-run constant.
    const target = [0.7, 0.1, 0.05, 0.05, 0.05, 0.05];
    const start = [0.1, 0.1, 0.1, 0.1, 0.1, 0.5];
    const a150 = smoothingAlpha(150, 180);
    const twoSteps = blend(target, blend(target, start, a150), a150);
    const oneStep = blend(target, start, smoothingAlpha(300, 180));
    for (const [i, x] of twoSteps.entries()) expect(x).toBeCloseTo(oneStep[i] ?? Number.NaN, 12);
  });

  it("stays a valid distribution for any alpha in [0, 1]", () => {
    const d = fc
      .array(fc.integer({ min: 1, max: 100 }), { minLength: 6, maxLength: 6 })
      .map((xs) => xs.map((x) => x / sum(xs)));
    fc.assert(
      fc.property(d, d, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, alpha) => {
        const r = blend(a, b, alpha);
        expect(sum(r)).toBeCloseTo(1, 12);
        for (const x of r) expect(x).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
