import { geoDistance, geoInterpolate } from "d3-geo";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arc, slerp } from "./sphere";

const lonLat = fc.tuple(
  fc.double({ min: -180, max: 180, noNaN: true }),
  fc.double({ min: -89, max: 89, noNaN: true }),
);
const RAD = Math.PI / 180;

describe("great-circle maths (checked against d3-geo, the renderer's own maths)", () => {
  it("arc equals d3 geoDistance wherever d3 is precise", () => {
    fc.assert(
      fc.property(lonLat, lonLat, (a, b) => {
        // d3 uses haversine, ill-conditioned within ~0.1° of the antipode (checked exactly below).
        fc.pre(geoDistance(a, b) < Math.PI - 2e-3);
        expect(arc(a, b)).toBeCloseTo(geoDistance(a, b), 10);
      }),
    );
  });

  it("arc is exact near the antipode, where haversine is not", () => {
    for (const eps of [1e-2, 1e-5, 1e-6]) {
      // Along the equator the true angle is just the longitude difference.
      expect(arc([0, 0], [180 - eps, 0])).toBeCloseTo((180 - eps) * RAD, 12);
      // Through the pole: (0, 89) to (180, −89 + eps) is 180° − eps.
      expect(arc([0, 89], [180, -89 + eps])).toBeCloseTo((180 - eps) * RAD, 12);
    }
  });

  it("slerp follows d3 geoInterpolate", () => {
    fc.assert(
      fc.property(lonLat, lonLat, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, t) => {
        fc.pre(arc(a, b) < Math.PI - 1e-3); // near-antipodes have no unique path
        const p = slerp(a, b)(t);
        const q = geoInterpolate(a, b)(t);
        expect(geoDistance(p, q) / RAD).toBeLessThan(1e-6);
      }),
    );
  });

  it("moves at constant speed along the arc", () => {
    const a: [number, number] = [-100, 40];
    const b: [number, number] = [100, 35];
    const f = slerp(a, b);
    const d = arc(a, b);
    for (const t of [0.1, 0.5, 0.8]) expect(arc(a, f(t))).toBeCloseTo(d * t, 9);
  });

  it("antipodes still give a continuous half-turn", () => {
    const f = slerp([0, 0], [180, 0]);
    expect(arc([0, 0], f(0.5)) / RAD).toBeCloseTo(90, 6);
    expect(arc([180, 0], f(1)) / RAD).toBeLessThan(1e-6);
  });

  it("a tiny move never travels farther than the move itself (regression: half-turn)", () => {
    fc.assert(
      fc.property(
        lonLat,
        fc.double({ min: 1e-14, max: 1e-5, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, step, t) => {
          const b: [number, number] = [a[0] + step / RAD, a[1]];
          const d = arc(a, b);
          expect(arc(a, slerp(a, b)(t))).toBeLessThanOrEqual(d + 1e-12);
        },
      ),
    );
  });

  it("a zero-length move stays put", () => {
    expect(slerp([10, 20], [10, 20])(0.7)).toEqual([10, 20]);
  });
});
