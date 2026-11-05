import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniform } from "./dist";
import { shrink } from "./shrink";
import { sum } from "./test-fixtures";

const countsArb = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 6, maxLength: 6 });
const distArb = fc
  .array(fc.integer({ min: 1, max: 1000 }), { minLength: 6, maxLength: 6 })
  .map((xs) => xs.map((x) => x / sum(xs)));

describe("shrink", () => {
  it("returns exactly the parent when there are no votes", () => {
    const parent = [0.3, 0.2, 0.1, 0.2, 0.1, 0.1];
    expect(shrink([0, 0, 0, 0, 0, 0], parent, 15)).toEqual(parent);
  });

  it("lets one vote nudge but not dominate (n=1, k=15)", () => {
    const r = shrink([0, 0, 0, 1, 0, 0], uniform(), 15);
    expect(r[3]).toBeCloseTo((1 + 15 / 6) / 16, 12); // 0.21875
    expect(r[0]).toBeCloseTo(15 / 6 / 16, 12); // 0.15625
  });

  it("lets a large sample speak for itself (n ≫ k)", () => {
    const r = shrink([100_000, 0, 0, 0, 0, 0], uniform(), 15);
    expect(r[0]).toBeGreaterThan(0.9998);
  });

  it.each([0, -1, Number.NaN])("rejects k = %s", (k) => {
    expect(() => shrink([1, 0, 0, 0, 0, 0], uniform(), k)).toThrow(RangeError);
  });

  it("always yields a distribution summing to 1", () => {
    fc.assert(
      fc.property(countsArb, distArb, fc.integer({ min: 1, max: 50 }), (c, p, k) => {
        expect(sum(shrink(c, p, k))).toBeCloseTo(1, 12);
      }),
    );
  });

  it("puts every component between the local share and the parent", () => {
    fc.assert(
      fc.property(countsArb, distArb, fc.integer({ min: 1, max: 50 }), (c, p, k) => {
        const n = sum(c);
        fc.pre(n > 0);
        shrink(c, p, k).forEach((x, i) => {
          const local = (c[i] ?? 0) / n;
          const parent = p[i] ?? 0;
          expect(x).toBeGreaterThanOrEqual(Math.min(local, parent) - 1e-12);
          expect(x).toBeLessThanOrEqual(Math.max(local, parent) + 1e-12);
        });
      }),
    );
  });
});
