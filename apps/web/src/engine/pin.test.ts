import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo";
import type { Feature } from "geojson";
import { beforeAll, describe, expect, it } from "vitest";
import { type Lod, loadLod } from "./geo";
import { pinPoint } from "./pin";

let lod: Lod;
beforeAll(async () => {
  lod = await loadLod("50m");
});
const country = (code: string) => lod.countries.find((f) => f.id === code) as Feature;

describe("pinPoint (real 50m map)", () => {
  it.each([
    // [code, [west, south, east, north] of the mainland it must land in]
    ["US", [-125, 24, -66, 50]],
    ["FR", [-5, 42, 8.5, 51.5]],
    ["NO", [4, 57, 31, 72]],
    ["NG", [2.5, 4, 15, 14]],
    ["ID", [94, -11, 141, 6]],
  ] as const)("%s lands on its mainland", (code, [w, s, e, n]) => {
    const [lon, lat] = pinPoint(country(code));
    expect(lon).toBeGreaterThan(w);
    expect(lon).toBeLessThan(e);
    expect(lat).toBeGreaterThan(s);
    expect(lat).toBeLessThan(n);
  });

  it("France's whole-shape centroid is in the Atlantic (why this exists)", () => {
    const fr = country("FR");
    expect(geoContains(fr, geoCentroid(fr))).toBe(false);
  });

  it("every country's pin is inside that country (all 237, not a sample)", () => {
    expect(lod.countries.length).toBeGreaterThan(200);
    // Zero-area shapes have no inside at all: Vatican and Tuvalu collapse to lines in the 50m
    // map's quantisation. They are the only allowed exceptions, and they can never be tapped on
    // the globe either (the check-in search reaches them).
    const zeroArea = lod.countries.filter((f) => geoArea(f) === 0).map((f) => f.id);
    expect(zeroArea).toEqual(["TV", "VA"]);
    const outside = lod.countries.filter((f) => !geoContains(f, pinPoint(f))).map((f) => f.id);
    expect(outside, "pins outside their country").toEqual(zeroArea);
    for (const code of zeroArea) {
      const [[w, s], [e, n]] = geoBounds(country(code as string));
      const [lon, lat] = pinPoint(country(code as string));
      expect(
        lon >= w - 1e-9 && lon <= e + 1e-9 && lat >= s - 1e-9 && lat <= n + 1e-9,
        `${code}`,
      ).toBe(true);
    }
  });
});
