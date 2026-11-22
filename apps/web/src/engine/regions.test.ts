import { buildSnapshot } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import type { SnapshotRegion } from "@world-emotion/shared";
import { geoOrthographic } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  alongside,
  barsOf,
  clarity,
  hitCountry,
  LAND_HALF_AREA,
  panelModel,
  QUIET_THEME,
  regionOf,
  sizeWeight,
  themeFor,
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
  const at = (lon: number, lat: number) => new Float32Array([lon, lat]);
  const BIG = 0.05; // a large country's area (sr): size weight ~1
  const centroids = [
    { code: "FR", points: at(2, 46), area: BIG },
    { code: "LU", points: at(6, 49.7), area: BIG },
    { code: "BR", points: at(-53, -10), area: BIG },
    { code: "ZZ", points: at(0, 0), area: BIG },
  ];
  it("weights published regions above quiet ones, skips unknown codes", () => {
    const s = weatherSpawns(snapshot, centroids, COUNTRY_TO_CONTINENT, null);
    const by = new Map(s.map((p) => [p.points[0], p]));
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
    expect(s.map((p) => p.points[0]).sort()).toEqual([2, 6]);
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

describe("alongside (the line under 'You feel …')", () => {
  // FR in the fixture: 80 calm (1), 20 sad (4) = 100, published. LU: 1 sad, below the floor.
  it("country with enough check-ins: others = dist × n, minus you; names its headline", () => {
    const fr = snapshot.countries.FR as SnapshotRegion;
    const calm = alongside(snapshot, "FR", 1);
    expect(calm).toEqual({
      scope: "country",
      others: Math.round((fr.dist[1] ?? 0) * fr.n) - 1,
      feels: fr.h,
    });
    expect((calm as { others: number }).others).toBeGreaterThan(50);
  });
  it("country below the privacy floor, or published but small: the world's numbers", () => {
    const w = snapshot.world;
    const expected = {
      scope: "world",
      others: Math.round((w.dist[4] ?? 0) * w.n) - 1,
      feels: null,
    };
    expect(alongside(snapshot, "LU", 4), "suppressed").toEqual(expected);
    // Published but small: 30 check-ins in the country, plenty in the world.
    const small = {
      ...snapshot,
      countries: { ...snapshot.countries, XX: { n: 30, h: 4, dist: [0, 0, 0, 0, 1, 0] } },
    } as unknown as typeof snapshot;
    expect(alongside(small, "XX", 4), "published, under 50").toEqual(expected);
  });
  it("an early world gives the exact total, never a per-mood estimate", () => {
    const region = (n: number) => ({ n, h: 1, dist: [0.1, 0.5, 0.1, 0.1, 0.1, 0.1] }) as never;
    const world = (n: number) =>
      ({
        world: region(n),
        continents: {},
        countries: { XX: region(n) },
      }) as unknown as typeof snapshot;
    expect(alongside(world(49), "XX", 1)).toEqual({ scope: "early", total: 49 });
    expect(alongside(world(0), "XX", 1), "you are counted").toEqual({ scope: "early", total: 1 });
    expect(alongside(world(50), "XX", 1)).toEqual({ scope: "country", others: 24, feels: 1 });
  });
  it("never below zero: a mood nobody else has means you are the first", () => {
    const region = { n: 60, h: 2, dist: [0, 0, 1, 0, 0, 0] } as never;
    const s = {
      world: region,
      continents: {},
      countries: { XX: region },
    } as unknown as typeof snapshot;
    expect(alongside(s, "XX", 5)).toEqual({ scope: "country", others: 0, feels: 2 });
  });
});

describe("themeFor (the Earth follows the region in view)", () => {
  const region = (h: number, n = 100) => ({ n, h, dist: [] }) as never;
  const s = {
    world: region(2), // not the quiet Earth's mood, so a fallback to the world would show
    continents: { EU: region(3), SA: region(5) },
    countries: {},
  } as unknown as typeof snapshot;
  it("world view: the world headline's Earth; quiet below the floor", () => {
    expect(themeFor(s, null, 5)).toBe(2);
    expect(themeFor({ ...s, world: region(3, 4) } as never, null, 5)).toBe(QUIET_THEME);
  });
  it("zoomed in: that continent's mood, whatever the world feels", () => {
    expect(themeFor(s, "EU", 5)).toBe(3);
    expect(themeFor(s, "SA", 5)).toBe(5);
  });
  it("a continent absent from the snapshot (below the floor) rests on the quiet Earth", () => {
    expect(themeFor(s, "OC", 5)).toBe(QUIET_THEME);
  });
});

describe("sizeWeight (weather follows land, up to a point)", () => {
  it("is near 1 for large countries, fades for tiny ones, never zero, and rises with area", () => {
    expect(sizeWeight(0.19), "Australia").toBeGreaterThan(0.98);
    expect(sizeWeight(LAND_HALF_AREA)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(sizeWeight(0.00002), "a Pacific atoll nation").toBeLessThan(0.07);
    expect(sizeWeight(0.00002)).toBeGreaterThan(0);
    expect(sizeWeight(0)).toBe(0);
    const pairs: [number, number][] = [
      [0.0001, 0.001],
      [0.001, 0.01],
      [0.01, 0.1],
    ];
    for (const [a, b] of pairs) expect(sizeWeight(b)).toBeGreaterThan(sizeWeight(a));
  });
  it("in weatherSpawns: the same region, smaller land, less weather", () => {
    const one = (area: number) =>
      weatherSpawns(
        snapshot,
        [{ code: "FR", points: new Float32Array([2, 46]), area }],
        COUNTRY_TO_CONTINENT,
        null,
      )[0]?.weight ?? 0;
    expect(one(0.0001)).toBeLessThan(one(0.05) / 5);
  });
});
