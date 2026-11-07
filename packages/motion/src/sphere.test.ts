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
  it("arc equals d3 geoDistance", () => {
    fc.assert(
      fc.property(lonLat, lonLat, (a, b) => {
        expect(arc(a, b)).toBeCloseTo(geoDistance(a, b), 8); // formulas differ by ~5e-10 rad near antipodes
      }),
    );
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

  it("a zero-length move stays put", () => {
    expect(slerp([10, 20], [10, 20])(0.7)).toEqual([10, 20]);
  });
});
