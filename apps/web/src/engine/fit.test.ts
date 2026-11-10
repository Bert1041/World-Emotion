import { CONTINENTS } from "@world-emotion/shared";
import { geoDistance } from "d3-geo";
import { describe, expect, it } from "vitest";
import { CONTINENT_VIEWS } from "./camera";
import { fitFrameIn, framePoints, framePointsOf } from "./fit";

describe("framePoints", () => {
  it.each(CONTINENTS)("%s: every point is inside its box and on the near hemisphere", (c) => {
    const { center, box } = CONTINENT_VIEWS[c];
    const [[w, s], [e, n]] = box;
    const pts = framePoints(c);
    expect(pts.length).toBeGreaterThan(0);
    for (const [lon, lat] of pts) {
      expect(lon).toBeGreaterThanOrEqual(w - 1e-9);
      expect(lon).toBeLessThanOrEqual(e + 1e-9);
      expect(lat).toBeGreaterThanOrEqual(s - 1e-9);
      expect(lat).toBeLessThanOrEqual(n + 1e-9);
      expect(geoDistance(center, [lon, lat])).toBeLessThan(Math.PI / 2);
    }
  });
});

describe("framePointsOf", () => {
  it("drops the part of a wide box that faces away from the centre (no real continent is this wide)", () => {
    // 200° of longitude: the columns at ±100° are beyond the horizon from [0, 0].
    const pts = framePointsOf({
      center: [0, 0],
      box: [
        [-100, -10],
        [100, 10],
      ],
    });
    expect(pts.length).toBe(13 * 13 - 2 * 13);
    for (const [lon] of pts) expect(Math.abs(lon)).toBeLessThan(90);
  });
});

describe("fitFrameIn", () => {
  it("zooms in on a large free area and out on a small one, within the clamps", () => {
    const big = fitFrameIn("EU", 300, { x: 0, y: 0, w: 2000, h: 2000 });
    const small = fitFrameIn("AS", 300, { x: 0, y: 0, w: 200, h: 200 });
    expect(big.zoom).toBeGreaterThan(1);
    expect(big.zoom).toBeLessThanOrEqual(6);
    expect(small.zoom).toBeLessThan(1);
    expect(small.zoom).toBeGreaterThanOrEqual(0.4);
    expect(big.center).toEqual(CONTINENT_VIEWS.EU.center);
  });
});
