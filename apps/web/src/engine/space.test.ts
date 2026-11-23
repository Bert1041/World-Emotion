import { describe, expect, it } from "vitest";
import { rng } from "./particles";
import { edgeCopies, parallax, STAR_LAYERS, scatter, TILE } from "./space";

describe("space", () => {
  it("layers sit one tile up-left, so they can drift a whole tile without showing an edge", () => {
    for (const rot of [
      [0, 0],
      [123.4, -45],
      [-720, 89],
      [1e5, -1e5],
    ] as const)
      for (const l of STAR_LAYERS) {
        const [x, y] = parallax(rot, l.drift);
        expect(x).toBeGreaterThanOrEqual(-TILE);
        expect(x).toBeLessThan(0);
        expect(y).toBeGreaterThanOrEqual(-TILE);
        expect(y).toBeLessThan(0);
      }
  });

  it("far stars drift less than near ones for the same turn of the globe", () => {
    const moved = STAR_LAYERS.map(
      (l) => parallax([10, 0], l.drift)[0] - parallax([0, 0], l.drift)[0],
    );
    expect(moved[0]).toBeLessThan(moved[1] as number);
    expect(moved[1]).toBeLessThan(moved[2] as number);
  });

  it("drift is continuous: a small turn is a small move (except across the wrap)", () => {
    const l = STAR_LAYERS[2];
    if (!l) throw new Error("no near layer");
    const [a] = parallax([50, 0], l.drift);
    const [b] = parallax([50.5, 0], l.drift);
    expect(Math.abs(b - a)).toBeCloseTo(0.5 * l.drift);
  });

  it("stars are inside the tile, the right count, faint to bright", () => {
    for (const l of STAR_LAYERS) {
      const s = scatter(l, rng(1));
      expect(s).toHaveLength(l.count);
      for (const [x, y, r, a] of s) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(TILE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(TILE);
        expect(r).toBeLessThanOrEqual(0.25 + l.maxRadius);
        expect(a).toBeLessThanOrEqual(l.brightness);
      }
    }
  });

  it("a star over a tile edge is drawn again across it (seamless repeat), and only then", () => {
    expect(edgeCopies(0.5, 1)).toEqual([0, TILE]);
    expect(edgeCopies(TILE - 0.5, 1)).toEqual([0, -TILE]);
    expect(edgeCopies(TILE / 2, 1)).toEqual([0]);
  });
});
