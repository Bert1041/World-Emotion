import { readFileSync } from "node:fs";
import { buildSnapshot } from "@world-emotion/core";
import { CONTINENTS, checkinRequestSchema, parseSnapshot } from "@world-emotion/shared";
import { feature } from "topojson-client";
import { describe, expect, it } from "vitest";
import { COUNTRIES, COUNTRY_TO_CONTINENT, isKnownCountry } from "./index";

interface Topo {
  type: "Topology";
  objects: { countries: { geometries: { id?: string; type: string }[] } };
}
const load = (res: string): Topo =>
  JSON.parse(readFileSync(new URL(`../data/world-${res}.topo.json`, import.meta.url), "utf8"));
const topo = { "110m": load("110m"), "50m": load("50m") };
const ids = (t: Topo) => t.objects.countries.geometries.map((g) => g.id);
const codes = [...COUNTRIES.keys()];

describe("country map", () => {
  it("has 249 ISO codes + XK, and nothing retired", () => {
    expect(COUNTRIES.size).toBe(250);
    expect(isKnownCountry("XK")).toBe(true);
    for (const retired of ["AN", "CS"]) expect(isKnownCountry(retired)).toBe(false);
  });

  it("maps every code to exactly one valid continent", () => {
    for (const [code, info] of COUNTRIES) {
      expect(CONTINENTS, code).toContain(info.continent);
      expect(COUNTRY_TO_CONTINENT.get(code)).toBe(info.continent);
    }
    expect(COUNTRY_TO_CONTINENT.size).toBe(COUNTRIES.size);
  });

  it("puts every continent to use", () => {
    expect(new Set(COUNTRY_TO_CONTINENT.values())).toEqual(new Set(CONTINENTS));
  });

  it("rejects Cloudflare's non-countries and malformed codes", () => {
    for (const bad of ["XX", "T1", "ZZ", "fr", "FRA", ""]) expect(isKnownCountry(bad)).toBe(false);
  });

  it("every accepted code passes the check-in schema (and so can be submitted)", () => {
    const id = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
    for (const country of codes) {
      expect(
        checkinRequestSchema.safeParse({ mood: 0, country, checkinId: id }).success,
        country,
      ).toBe(true);
    }
  });
});

describe("decisions (docs/geo-decisions.md)", () => {
  const continentOf = (c: string) => COUNTRIES.get(c)?.continent;

  it("G1: open-ocean codes take GeoNames' continent", () => {
    expect(
      Object.fromEntries(
        ["GS", "HM", "TF", "IO", "MV", "MU", "SC", "SH"].map((c) => [c, continentOf(c)]),
      ),
    ).toEqual({
      GS: "AN",
      HM: "AN",
      TF: "AN",
      IO: "AS",
      MV: "AS",
      MU: "AF",
      SC: "AF",
      SH: "AF",
    });
  });

  it("G2: Cyprus is Europe, Timor-Leste is Asia", () => {
    expect(continentOf("CY")).toBe("EU");
    expect(continentOf("TL")).toBe("AS");
  });

  it("G3: the 13 shapeless territories are their own entries on their real continent", () => {
    const shapeless = codes.filter((c) => COUNTRIES.get(c)?.shape === false).sort();
    expect(shapeless).toEqual([
      "BQ",
      "BV",
      "CC",
      "CX",
      "GF",
      "GI",
      "GP",
      "MQ",
      "RE",
      "SJ",
      "TK",
      "UM",
      "YT",
    ]);
    expect(continentOf("RE")).toBe("AF"); // not Europe via France
    expect(continentOf("GF")).toBe("SA");
    expect(continentOf("GP")).toBe("NA");
  });

  it("G5: Kosovo is Europe", () => expect(continentOf("XK")).toBe("EU"));

  it("transcontinental countries follow both sources", () => {
    expect({
      RU: continentOf("RU"),
      TR: continentOf("TR"),
      EG: continentOf("EG"),
      PA: continentOf("PA"),
    }).toEqual({
      RU: "EU",
      TR: "AS",
      EG: "AF",
      PA: "NA",
    });
  });

  it("Australia is one Oceanian entry despite three Natural Earth shapes", () => {
    expect(continentOf("AU")).toBe("OC");
  });
});

describe.each(["110m", "50m"] as const)("TopoJSON %s", (res) => {
  const t = topo[res];

  it("is a topology with a countries object", () => {
    expect(t.type).toBe("Topology");
    expect(t.objects.countries.geometries.length).toBeGreaterThan(100);
  });

  it("only uses codes from the map", () => {
    for (const id of ids(t)) if (id !== undefined) expect(isKnownCountry(id), id).toBe(true);
  });

  it("has each code at most once (duplicates merged)", () => {
    const coded = ids(t).filter((id) => id !== undefined);
    expect(coded.length).toBe(new Set(coded).size);
  });

  it("never draws a shapeless territory", () => {
    for (const id of ids(t)) if (id !== undefined) expect(COUNTRIES.get(id)?.shape, id).toBe(true);
  });
});

describe("TopoJSON 50m (the reference level)", () => {
  it("has exactly one geometry for every code with a shape", () => {
    const present = new Set(ids(topo["50m"]));
    for (const [code, info] of COUNTRIES)
      if (info.shape) expect(present.has(code), code).toBe(true);
  });

  it("G4: keeps exactly the 3 uncoded shapes, unselectable (no id)", () => {
    expect(ids(topo["50m"]).filter((id) => id === undefined)).toHaveLength(3);
  });

  it("110m is a subset of 50m", () => {
    const fifty = new Set(ids(topo["50m"]));
    for (const id of ids(topo["110m"])) if (id !== undefined) expect(fifty.has(id), id).toBe(true);
  });
});

describe("geometry content (not just ids)", () => {
  const bbox = (res: "110m" | "50m", code: string) => {
    const fc = feature(
      topo[res] as unknown as Parameters<typeof feature>[0],
      "countries",
    ) as unknown as {
      features: { id?: string; geometry: { coordinates: unknown } }[];
    };
    const f = fc.features.find((x) => x.id === code);
    const lons: number[] = [];
    const lats: number[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v) && typeof v[0] === "number") {
        lons.push(v[0]);
        lats.push(v[1] as number);
      } else if (Array.isArray(v)) for (const x of v) walk(x);
    };
    walk(f?.geometry.coordinates);
    return {
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    };
  };

  it("Australia at 50m is all three Natural Earth shapes merged, not the last one seen", () => {
    const b = bbox("50m", "AU");
    expect(b.maxLon).toBeGreaterThan(153); // mainland east coast
    expect(b.minLat).toBeLessThan(-43); // Tasmania
    expect(b.minLon).toBeLessThan(106); // Christmas Island (the "Indian Ocean Ter." shape)
  });

  it("France at 50m includes its overseas departments drawn by Natural Earth", () => {
    expect(bbox("50m", "FR").minLon).toBeLessThan(-50); // French Guiana is part of FR's shape
  });
});

describe("integration with core", () => {
  it("builds a valid snapshot with every country on the real map voting", () => {
    const counts = codes.flatMap((country, i) => [{ country, mood: i % 6, n: 5 + (i % 7) }]);
    const { snapshot } = buildSnapshot({
      counts,
      countryToContinent: COUNTRY_TO_CONTINENT,
      now: 1_700_000_000,
    });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed.ok ? "ok" : parsed.error).toBe("ok");
    expect(snapshot.world.n).toBe(counts.reduce((s, c) => s + c.n, 0));
    expect(Object.keys(snapshot.continents).sort()).toEqual([...CONTINENTS].sort());
  });
});
