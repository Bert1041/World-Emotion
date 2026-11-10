import { buildSnapshot } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import type { SnapshotRegion } from "@world-emotion/shared";
import { geoOrthographic } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  barsOf,
  clarity,
  hitCountry,
  panelModel,
  QUIET_THEME,
  regionOf,
  weatherSpawns,
  worldHeadline,
} from "./regions";

/** Real pipeline output: FR well above the privacy floor, LU below it (suppressed). */
const { snapshot } = buildSnapshot({
  counts: [
    { country: "FR", mood: 1, n: 80 },
    { country: "FR", mood: 4, n: 20 },
    { country: "DE", mood: 1, n: 30 },
    { country: "LU", mood: 4, n: 1 },
    { country: "BR", mood: 0, n: 30 },
  ],
  countryToContinent: COUNTRY_TO_CONTINENT,
  now: 1_700_000_000,
});
const COLORS = ["#0", "#1", "#2", "#3", "#4", "#5"];
const region = (dist: number[], h = 0, n = 10): SnapshotRegion =>
  ({ dist, h, n }) as SnapshotRegion;

describe("clarity", () => {
  it("is 0 at a dead heat, 1 when the lead is 25 points or more, linear between", () => {
    expect(clarity(region([0.5, 0.5, 0, 0, 0, 0]))).toBe(0);
    expect(clarity(region([0.6, 0.35, 0.05, 0, 0, 0]))).toBe(1);
    expect(clarity(region([0.4, 0.275, 0, 0, 0, 0]))).toBeCloseTo(0.5);
    expect(clarity(region([1, 0, 0, 0, 0, 0]))).toBe(1);
  });
});

describe("regionOf", () => {
  it("returns a published country as its own region", () => {
    const r = regionOf(snapshot, "FR", COUNTRY_TO_CONTINENT);
    expect(r?.quiet).toBe(false);
    expect(r?.region.n).toBe(100);
  });
  it("falls back to the continent, marked quiet, below the privacy floor", () => {
    expect(snapshot.countries.LU, "fixture: LU must be suppressed").toBeUndefined();
    const r = regionOf(snapshot, "LU", COUNTRY_TO_CONTINENT);
    expect(r?.quiet).toBe(true);
    expect(r?.region).toBe(snapshot.continents.EU);
  });
  it("is null for a code the map does not know", () => {
    expect(regionOf(snapshot, "ZZ", COUNTRY_TO_CONTINENT)).toBeNull();
  });
});

describe("barsOf", () => {
  it("one bar per mood, whole percentages, the headline marked lead", () => {
    const bars = barsOf(region([0.5, 0.25, 0.125, 0.125, 0, 0], 1), COLORS);
    expect(bars.map((b) => b.pct)).toEqual([50, 25, 13, 13, 0, 0]);
    expect(bars.map((b) => b.lead)).toEqual([false, true, false, false, false, false]);
    expect(bars[2]?.color).toBe("#2");
  });
});

describe("panelModel", () => {
  it("is null in the world view", () => {
    expect(panelModel(snapshot, null, null, COUNTRY_TO_CONTINENT, COLORS)).toBeNull();
  });
  it("a continent card shows its count and bars", () => {
    const p = panelModel(snapshot, "EU", null, COUNTRY_TO_CONTINENT, COLORS);
    expect(p?.place).toEqual({ kind: "continent", id: "EU" });
    expect(p?.status).toEqual({ kind: "count", n: snapshot.continents.EU?.n });
    expect(p?.bars).toHaveLength(6);
  });
  it("a quiet country shows the continent and no mood of its own", () => {
    const p = panelModel(snapshot, "EU", "LU", COUNTRY_TO_CONTINENT, COLORS);
    expect(p?.place).toEqual({ kind: "country", code: "LU" });
    expect(p?.mood).toBeNull();
    expect(p?.status).toEqual({ kind: "quietShowing", continent: "EU" });
  });
  it("an unknown continent is quiet with no bars", () => {
    const p = panelModel(snapshot, "AN", null, COUNTRY_TO_CONTINENT, COLORS);
    expect(p?.status).toEqual({ kind: "quiet" });
    expect(p?.bars).toEqual([]);
  });
});

describe("weatherSpawns", () => {
  const centroids = [
    { code: "FR", lon: 2, lat: 46 },
    { code: "LU", lon: 6, lat: 49.7 },
    { code: "BR", lon: -53, lat: -10 },
    { code: "ZZ", lon: 0, lat: 0 },
  ];
  it("weights published regions above quiet ones, skips unknown codes", () => {
    const s = weatherSpawns(snapshot, centroids, COUNTRY_TO_CONTINENT, null);
    const by = new Map(s.map((p) => [p.lon, p]));
    expect(by.has(0), "unknown code").toBe(false);
    expect(by.has(-53), "a published country on another continent spawns in the world view").toBe(
      true,
    );
    expect((by.get(2)?.weight ?? 0) > (by.get(6)?.weight ?? 0), "FR louder than quiet LU").toBe(
      true,
    );
  });
  it("zoomed into a continent, only its countries spawn", () => {
    const s = weatherSpawns(snapshot, centroids, COUNTRY_TO_CONTINENT, "EU");
    expect(s.map((p) => p.lon).sort()).toEqual([2, 6]);
  });
});

describe("hitCountry", () => {
  const projection = geoOrthographic().scale(100).translate([100, 100]);
  // A 10°×10° square "country" around the origin, id "SQ", mapped to Africa. Wound clockwise:
  // d3-geo polygons are spherical, and the other winding means "everything but the square".
  const square = {
    type: "Feature",
    id: "SQ",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-5, -5],
          [-5, 5],
          [5, 5],
          [5, -5],
          [-5, -5],
        ],
      ],
    },
  };
  const countries = [square] as unknown as NonNullable<
    Parameters<typeof hitCountry>[2]["countries"]
  >;
  const map = new Map([["SQ", "AF" as const]]);

  it("finds the country under the centre, with its continent and lon/lat", () => {
    const hit = hitCountry(100, 100, { projection, dpr: 1, countries, map });
    expect(hit?.code).toBe("SQ");
    expect(hit?.continent).toBe("AF");
    expect(hit?.lonLat[0]).toBeCloseTo(0, 5);
  });
  it("is null on ocean, off the disc, and before the map has loaded", () => {
    expect(hitCountry(150, 100, { projection, dpr: 1, countries, map }), "ocean").toBeNull();
    // d3 clamps an inverse outside the disc to the rim. Put the square on the rim (rotate 90°),
    // then tap in space just beyond it: without the disc check this would "hit" the square.
    const rim = geoOrthographic().scale(100).translate([150, 100]).rotate([-90, 0]);
    expect(
      hitCountry(50, 100, { projection: rim, dpr: 1, countries, map })?.code,
      "on the rim",
    ).toBe("SQ");
    expect(hitCountry(20, 100, { projection: rim, dpr: 1, countries, map }), "space").toBeNull();
    expect(
      hitCountry(100, 100, { projection, dpr: 1, countries: undefined, map }),
      "no map yet",
    ).toBeNull();
  });
  it("accounts for device pixel ratio", () => {
    const hi = geoOrthographic().scale(200).translate([200, 200]);
    expect(hitCountry(100, 100, { projection: hi, dpr: 2, countries, map })?.code).toBe("SQ");
  });
});

describe("worldHeadline", () => {
  const world = (n: number, h = 3 as const) => ({ world: { n, h, dist: [] } }) as never;
  it("is quiet below the floor: no mood word, the quiet Earth", () => {
    for (const n of [0, 1, 4]) {
      expect(worldHeadline(world(n), 5)).toEqual({ quiet: true, mood: null, theme: QUIET_THEME });
    }
  });
  it("shows the headline mood and its Earth at the floor and above", () => {
    expect(worldHeadline(world(5), 5)).toEqual({ quiet: false, mood: 3, theme: 3 });
    expect(worldHeadline(world(28_000), 5)).toEqual({ quiet: false, mood: 3, theme: 3 });
  });
  it("the quiet Earth is Waterworld (calm), which is not the tie-break mood (happy)", () => {
    expect(QUIET_THEME).toBe(1);
  });
});
