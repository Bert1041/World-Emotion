import { geoContains, geoDistance } from "d3-geo";
import { beforeAll, describe, expect, it } from "vitest";
import { type Lod, loadLod } from "./geo";
import { landSamples } from "./land";
import { rng } from "./particles";
import { pinPoint } from "./pin";

let lod50: Lod;
beforeAll(async () => {
  lod50 = await loadLod("50m");
});

const K = 8;

describe("landSamples on the real 50m map", () => {
  it("every point of every country is inside that country, or is its pin point", () => {
    const random = rng(42);
    const t0 = performance.now();
    const all = lod50.countries.map((f) => ({ f, pts: landSamples(f, K, random) }));
    const ms = performance.now() - t0;
    console.log(`landSamples: ${all.length} countries x ${K} in ${ms.toFixed(0)} ms`);
    expect(all.length).toBeGreaterThan(230);
    const bad: string[] = [];
    let fallbacks = 0;
    for (const { f, pts } of all) {
      const pin = pinPoint(f);
      for (let i = 0; i < K; i++) {
        const p: [number, number] = [pts[i * 2] as number, pts[i * 2 + 1] as number];
        const isPin = geoDistance(p, pin) < 1e-6;
        if (isPin) fallbacks++;
        if (!isPin && !geoContains(f, p)) bad.push(`${String(f.id)} ${p.join(",")}`);
      }
    }
    expect(bad, "points outside their country").toEqual([]);
    console.log(`fallback points (pin): ${fallbacks} of ${all.length * K}`);
  });

  it("spreads across a country's landmasses: France gets points in Europe, not only one spot", () => {
    const fr = lod50.countries.find((f) => String(f.id) === "FR");
    expect(fr).toBeDefined();
    const pts = landSamples(fr as NonNullable<typeof fr>, 40, rng(1));
    const lons = new Set<number>();
    for (let i = 0; i < 40; i++) lons.add(Math.round(pts[i * 2] as number));
    expect(lons.size, "distinct whole degrees of longitude").toBeGreaterThan(4);
  });

  it("works across the antimeridian (Fiji, Russia)", () => {
    for (const code of ["FJ", "RU"]) {
      const f = lod50.countries.find((x) => String(x.id) === code);
      expect(f, code).toBeDefined();
      // A generous try budget: this checks the date-line geometry, not the app's budget.
      const pts = landSamples(f as NonNullable<typeof f>, K, rng(7), K * 40);
      // Real samples, not the pin fallback: a wrong span would miss the country entirely.
      const pin = pinPoint(f as NonNullable<typeof f>);
      let real = 0;
      for (let i = 0; i < K; i++)
        if (geoDistance([pts[i * 2] as number, pts[i * 2 + 1] as number], pin) > 1e-6) real++;
      expect(real, `${code}: mostly sampled, not fallen back`).toBeGreaterThanOrEqual(K / 2);
      for (let i = 0; i < K; i++) {
        const p: [number, number] = [pts[i * 2] as number, pts[i * 2 + 1] as number];
        expect(Math.abs(p[0]), `${code} lon in range`).toBeLessThanOrEqual(180);
        expect(
          geoContains(f as NonNullable<typeof f>, p) ||
            geoDistance(p, pinPoint(f as NonNullable<typeof f>)) < 1e-6,
          code,
        ).toBe(true);
      }
    }
  });
});
