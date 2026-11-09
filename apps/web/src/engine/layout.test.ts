import { describe, expect, it } from "vitest";
import { circleHitsRect, fitGlobe, fitRegion, freeArea, GAP, HALO, rectsOverlap } from "./layout";

const vp = { w: 1440, h: 900 };
const header = { x: 0, y: 16, w: 1440, h: 80 };

describe("freeArea", () => {
  it("is the viewport minus the gap when there is no UI", () => {
    expect(freeArea({ viewport: vp })).toEqual({
      x: GAP,
      y: GAP,
      w: 1440 - 2 * GAP,
      h: 900 - 2 * GAP,
    });
  });

  it("stops left of a bar docked to the right edge", () => {
    const bar = { x: 1440 - 16 - 200, y: 16, w: 200, h: 868 };
    const f = freeArea({ viewport: vp, right: bar });
    expect(f.x + f.w).toBe(bar.x - GAP);
    expect([f.y, f.h]).toEqual([GAP, 900 - 2 * GAP]);
  });

  it("starts below the headline", () => {
    const f = freeArea({ viewport: vp, top: header });
    expect(f.y).toBe(16 + 80 + GAP);
  });

  it("ends above a bottom bar", () => {
    const f = freeArea({ viewport: vp, bottom: { x: 0, y: 860, w: 500, h: 30 } });
    expect(f.y + f.h).toBe(860 - GAP);
  });

  it("starts right of a side card", () => {
    const f = freeArea({ viewport: vp, card: { x: 24, y: 300, w: 300, h: 300 }, cardSide: "left" });
    expect(f.x).toBe(24 + 300 + GAP);
  });

  it("ends above a bottom card", () => {
    const f = freeArea({
      viewport: { w: 390, h: 844 },
      card: { x: 16, y: 520, w: 358, h: 300 },
      cardSide: "bottom",
    });
    expect(f.y + f.h).toBe(520 - GAP);
  });

  it("never goes negative when UI fills the screen", () => {
    const f = freeArea({ viewport: { w: 300, h: 200 }, top: { x: 0, y: 0, w: 300, h: 190 } });
    expect(f.h).toBe(0);
  });
});

describe("fitGlobe", () => {
  it("keeps the globe and its halo inside the free area", () => {
    const free = { x: 16, y: 112, w: 1408, h: 772 };
    const g = fitGlobe(free);
    expect(g.r * HALO).toBeCloseTo(772 / 2, 6);
    expect(g.cy).toBe(112 + 772 / 2);
    expect(circleHitsRect({ ...g, r: g.r * HALO }, { x: 0, y: 0, w: 1440, h: 112 - 0.001 })).toBe(
      false,
    );
  });

  it("is limited by width on a portrait phone", () => {
    expect(fitGlobe({ x: 16, y: 100, w: 358, h: 700 }).r).toBeCloseTo(358 / 2 / HALO, 6);
  });
});

describe("fitRegion", () => {
  it("fills the free area along the region's tighter axis", () => {
    const pts: [number, number][] = [
      [-100, -50],
      [100, 50],
    ]; // 200 × 100
    const r = fitRegion(pts, { x: 0, y: 0, w: 800, h: 800 }, 100);
    expect(r.zoom).toBe(4); // width-limited: 800 / 200
    expect(r.offset).toEqual([0, 0]);
  });

  it("reports the region's centre as an offset in base-radius units", () => {
    const r = fitRegion(
      [
        [100, 0],
        [300, 100],
      ],
      { x: 0, y: 0, w: 400, h: 400 },
      100,
    );
    expect(r.offset).toEqual([2, 0.5]);
  });

  it("clamps zoom to its limits", () => {
    expect(
      fitRegion(
        [
          [0, 0],
          [1, 1],
        ],
        { x: 0, y: 0, w: 900, h: 900 },
        100,
      ).zoom,
    ).toBe(6);
    expect(
      fitRegion(
        [
          [0, 0],
          [5000, 5000],
        ],
        { x: 0, y: 0, w: 900, h: 900 },
        100,
      ).zoom,
    ).toBe(1);
  });

  it("falls back to the whole globe with no points", () => {
    expect(fitRegion([], { x: 0, y: 0, w: 100, h: 100 }, 100)).toEqual({ zoom: 1, offset: [0, 0] });
  });
});

describe("geometry helpers", () => {
  it("circleHitsRect: inside, touching edge, clear", () => {
    expect(circleHitsRect({ cx: 50, cy: 50, r: 10 }, { x: 45, y: 45, w: 5, h: 5 })).toBe(true);
    expect(circleHitsRect({ cx: 50, cy: 50, r: 10 }, { x: 60, y: 40, w: 5, h: 20 })).toBe(false); // tangent
    expect(circleHitsRect({ cx: 50, cy: 50, r: 10 }, { x: 58, y: 58, w: 5, h: 5 })).toBe(false); // corner clear
  });

  it("rectsOverlap: overlapping, touching, apart", () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toBe(false);
  });
});
