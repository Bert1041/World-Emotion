/**
 * The globe never turns a country inside out (found 2026-11-09: while spinning, single frames had
 * the whole globe flooded with one country's colour). Two causes, two guards, both tested on the
 * real maps: degenerate rings are not drawn (`drawable`), and polygons that d3 clips inside out at
 * the horizon are dropped for that frame (`addGuarded`, the same function the renderer calls).
 */
import { geoArea, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { beforeAll, describe, expect, it } from "vitest";
import { addGuarded, areaBound, ShapeRecorder } from "./clip-guard";
import { CLIP_ANGLE, drawable, type Lod, loadLod, loadMoveLod } from "./geo";

const NAMES = ["move", "110m", "50m"] as const;
let lods: Record<(typeof NAMES)[number], Lod>;
beforeAll(async () => {
  // keep 0.25: the app's moveKeep default.
  lods = {
    move: await loadMoveLod(0.25),
    "110m": await loadLod("110m"),
    "50m": await loadLod("50m"),
  };
});

const rings = (f: Feature): Position[][] => {
  const g = f.geometry as Polygon | MultiPolygon | null;
  if (g === null) return [];
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
};
const distinct = (ring: Position[]) => new Set(ring.map((p) => `${p[0]},${p[1]}`)).size;

const R = 1000; // globe radius, px
/** The app's projection (main.ts): orthographic, clipped at CLIP_ANGLE, no resampling. */
const appProjection = (rotate: [number, number]) =>
  geoOrthographic().clipAngle(CLIP_ANGLE).precision(0).scale(R).translate([0, 0]).rotate(rotate);
const DISK = Math.PI * R * R;

/** Draw one shape as the renderer does, into a recorder; returns drawn area and drops. */
function drawGuarded(lod: Lod, f: Feature, rotate: [number, number]) {
  const proj = appProjection(rotate);
  const canvas = new ShapeRecorder();
  const recorder = new ShapeRecorder();
  const asCtx = (r: ShapeRecorder) => r as unknown as CanvasRenderingContext2D;
  const dropped = addGuarded(
    lod.parts.get(f) ?? [],
    [-rotate[0], -rotate[1]],
    R,
    true,
    geoPath(proj, asCtx(canvas)),
    geoPath(proj, asCtx(recorder)),
    recorder,
    asCtx(canvas),
  );
  return { area: canvas.area(), dropped };
}

describe("drawn shapes", () => {
  it.each(NAMES)("%s: every ring has ≥ 3 distinct points", (name) => {
    const bad: string[] = [];
    for (const f of [...lods[name].shapes.countries, ...lods[name].shapes.neutral])
      for (const r of rings(f)) if (distinct(r) < 3) bad.push(String(f.id ?? "neutral"));
    expect(bad).toEqual([]);
  });

  it.each(NAMES)("%s: cleaning removes no area", (name) => {
    const lod = lods[name];
    for (const f of [...lod.countries, ...lod.neutral]) {
      const d = drawable(f);
      expect(d === null ? 0 : geoArea(d), String(f.id)).toBeCloseTo(geoArea(f), 12);
    }
  });

  it.each(NAMES)("%s: data lists stay complete; every shape is one of them", (name) => {
    const lod = lods[name];
    const ids = new Set(lod.countries.map((f) => f.id));
    for (const f of lod.shapes.countries) expect(ids.has(f.id)).toBe(true);
    expect(lod.shapes.countries.length).toBeLessThanOrEqual(lod.countries.length);
  });

  it("Vatican and Tuvalu stay in the 50m data (pins, search) though nothing of them is drawn", () => {
    const ids = lods["50m"].countries.map((f) => f.id);
    expect(ids).toContain("VA");
    expect(ids).toContain("TV");
  });

  it("healthy features pass through untouched", () => {
    const f = lods["110m"].countries.find((x) => x.id === "FR") as Feature;
    expect(drawable(f)).toBe(f);
  });

  it("the area bound holds for real polygons fully in view (it is never too tight)", () => {
    for (const name of NAMES)
      for (const parts of lods[name].parts.values())
        for (const { polygon, cap } of parts) {
          if (cap.radius > 1) continue;
          // Facing the polygon's own centre: the whole polygon is in view, nothing clipped.
          const proj = appProjection([-cap.center[0], -cap.center[1]]);
          expect(geoPath(proj).area(polygon)).toBeLessThanOrEqual(areaBound(cap.radius, R) * 1.001);
        }
  });
});

describe("no country turns inside out", () => {
  // Seeded views over the whole sphere; each shape that reaches the horizon is checked.
  function sweep(views: number) {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const flooded: string[] = [];
    let dropped = 0;
    let rawInversions = 0;
    for (let k = 0; k < views; k++) {
      const rotate: [number, number] = [rnd() * 360 - 180, rnd() * 160 - 80];
      const raw = geoPath(appProjection(rotate));
      for (const name of NAMES) {
        const lod = lods[name];
        for (const f of [...lod.shapes.countries, ...lod.shapes.neutral]) {
          const parts = lod.parts.get(f) ?? [];
          const center: [number, number] = [-rotate[0], -rotate[1]];
          const crosses = parts.some(({ cap }) => {
            const d = Math.acos(
              Math.min(
                1,
                Math.sin((cap.center[1] * Math.PI) / 180) * Math.sin((center[1] * Math.PI) / 180) +
                  Math.cos((cap.center[1] * Math.PI) / 180) *
                    Math.cos((center[1] * Math.PI) / 180) *
                    Math.cos(((cap.center[0] - center[0]) * Math.PI) / 180),
              ),
            );
            return Math.abs(d - Math.PI / 2) <= cap.radius;
          });
          if (!crosses) continue;
          if (raw.area(f) > 0.6 * DISK) rawInversions++;
          const g = drawGuarded(lod, f, rotate);
          dropped += g.dropped;
          if (g.area > 0.6 * DISK) flooded.push(`${name} ${String(f.id)} @${rotate}`);
        }
      }
    }
    return { flooded, dropped, rawInversions };
  }

  it("seeded sweep, all three maps: d3 alone floods; the guard never does", () => {
    const { flooded, dropped, rawInversions } = sweep(1500);
    // Not vacuous: unguarded d3 does turn shapes inside out in these very views.
    expect(rawInversions).toBeGreaterThan(5);
    expect(dropped).toBeGreaterThanOrEqual(rawInversions);
    expect(flooded).toEqual([]);
  }, 300_000);

  it("drops are rare (only the broken polygons, not healthy ones near the edge)", () => {
    const { dropped, rawInversions } = sweep(300);
    expect(dropped).toBeLessThanOrEqual(rawInversions * 2 + 2);
  }, 120_000);
});
