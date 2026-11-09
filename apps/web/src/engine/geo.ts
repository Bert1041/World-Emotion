import { geoCentroid, geoDistance } from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { feature, mesh } from "topojson-client";
import { presimplify, quantile, simplify, sphericalTriangleArea } from "topojson-simplify";

/**
 * "move" is the 110m map simplified further. It is drawn on every animation frame (drag, glide,
 * theme fade), where drawing cost scales with the number of points; "50m" is drawn once on settle.
 */
export type LodName = "move" | "110m" | "50m";

/**
 * Clip angle for every globe projection: the horizon. Clipping just inside it (89.999°, 89.9°) was
 * tried against d3 turning polygons inside out at the horizon; it only moved which views fail, so
 * engine/clip-guard.ts catches them instead.
 */
export const CLIP_ANGLE = 90;

export interface Lod {
  readonly name: LodName;
  /** Features with an ISO code (selectable, coloured by mood). */
  readonly countries: readonly Feature[];
  /** Features without a code (docs/geo-decisions.md G4): neutral, unselectable. */
  readonly neutral: readonly Feature[];
  /**
   * What is drawn: the same features with degenerate rings removed (see `drawable`), and features
   * left with no ring at all omitted. `countries`/`neutral` stay complete for data (pins, search).
   */
  readonly shapes: { readonly countries: readonly Feature[]; readonly neutral: readonly Feature[] };
  /** Internal borders as a single mesh: one stroke call per frame. */
  readonly borders: MultiLineString;
  /** Bounding cap per drawn shape (centre + angular radius, radians), for back-face culling. */
  readonly caps: ReadonlyMap<Feature, Cap>;
  /**
   * Each drawn shape as separate polygons with their own caps: the inside-out guard
   * (engine/clip-guard.ts) needs a tight bound per island, not per country (the US cap spans
   * Hawaii to Maine).
   */
  readonly parts: ReadonlyMap<Feature, readonly Part[]>;
}

export interface Part {
  readonly polygon: Polygon;
  readonly cap: Cap;
}

export interface Cap {
  readonly center: [number, number];
  readonly radius: number;
}

/** Smallest-effort bounding cap: centroid plus the farthest vertex. Computed once at load. */
function capOf(f: Feature | Polygon): Cap {
  const center = geoCentroid(f);
  let radius = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v) && typeof v[0] === "number")
      radius = Math.max(radius, geoDistance(center, v as Position as [number, number]));
    else if (Array.isArray(v)) for (const x of v) walk(x);
  };
  walk(
    f.type === "Feature" ? (f.geometry as { coordinates?: unknown }).coordinates : f.coordinates,
  );
  return { center, radius };
}

function partsOf(f: Feature): Part[] {
  const g = f.geometry as Polygon | MultiPolygon | null;
  if (g === null || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return [];
  const polys: Polygon[] =
    g.type === "Polygon"
      ? [g]
      : g.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  return polys.map((polygon) => ({ polygon, cap: capOf(polygon) }));
}

/**
 * A feature with every ring of fewer than 3 distinct points removed (and polygons whose outer
 * ring went), or null if nothing is left. Simplification and quantisation collapse small islands
 * and slivers into such rings: a repeated point, or a two-point line. They have no area, and near
 * the horizon d3's clipping read the two-point lines as inside out: Cyprus, Qatar, Palestine and
 * others flooded the whole globe for a frame while it spun (found 2026-11-09).
 */
export function drawable(f: Feature): Feature | null {
  const g = f.geometry as Polygon | MultiPolygon | null;
  if (g === null || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return f;
  const ok = (ring: Position[]) => new Set(ring.map((p) => `${p[0]},${p[1]}`)).size >= 3;
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
    .filter((rings) => rings[0] !== undefined && ok(rings[0]))
    .map((rings) => rings.filter(ok));
  const before = g.type === "Polygon" ? 1 : g.coordinates.length;
  const ringsBefore = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flat().length;
  if (polys.length === before && polys.flat().length === ringsBefore) return f;
  if (polys.length === 0) return null;
  return { ...f, geometry: { type: "MultiPolygon", coordinates: polys } };
}

type Topology = Parameters<typeof feature>[0];

function asTopology(raw: unknown): Topology {
  const t = raw as { type?: string; objects?: { countries?: unknown } };
  if (t?.type !== "Topology" || t.objects?.countries === undefined)
    throw new Error("not a countries topology");
  return raw as Topology;
}

/** Each level of detail is a separate lazy chunk, so neither counts toward initial JS. */
export async function loadLod(name: "110m" | "50m"): Promise<Lod> {
  const raw =
    name === "110m"
      ? (await import("@world-emotion/geo-data/world-110m.topo.json")).default
      : (await import("@world-emotion/geo-data/world-50m.topo.json")).default;
  return buildLod(name, asTopology(raw));
}

/**
 * The moving map: 110m with only the most significant `keep` share of its points (Visvalingam,
 * spherical area). Simplifying the topology, not each country, keeps shared borders identical on
 * both sides, so neighbours can never gap or overlap. Arc endpoints are always kept.
 */
export async function loadMoveLod(keep: number): Promise<Lod> {
  const raw = (await import("@world-emotion/geo-data/world-110m.topo.json")).default;
  // presimplify returns a new topology; the shared 110m module object is not modified.
  const pre = presimplify(asTopology(raw) as never, sphericalTriangleArea);
  // quantile(t, p) is the minimum weight that retains the share p of points.
  const out = simplify(pre, quantile(pre, Math.min(1, Math.max(0, keep))));
  return buildLod("move", out as unknown as Topology);
}

/** Total points in a level of detail (for the bench report and tests). */
export function pointCount(lod: Lod): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v) && typeof v[0] === "number") n++;
    else if (Array.isArray(v)) for (const x of v) walk(x);
  };
  for (const f of [...lod.countries, ...lod.neutral])
    walk((f.geometry as { coordinates?: unknown }).coordinates);
  return n;
}

function buildLod(name: LodName, topo: Topology): Lod {
  const obj = topo.objects.countries as Parameters<typeof mesh>[1];
  // topojson-client's overloads don't accept a loosely typed object; call the collection form.
  const toFeatures = feature as unknown as (t: Topology, o: unknown) => FeatureCollection;
  const fc = toFeatures(topo, obj);
  const shapes = fc.features.map(drawable).filter((f): f is Feature => f !== null);
  return {
    name,
    countries: fc.features.filter((f) => f.id !== undefined),
    neutral: fc.features.filter((f) => f.id === undefined),
    shapes: {
      countries: shapes.filter((f) => f.id !== undefined),
      neutral: shapes.filter((f) => f.id === undefined),
    },
    borders: mesh(topo, obj, (a, b) => a !== b) as MultiLineString,
    caps: new Map(shapes.map((f) => [f, capOf(f)])),
    parts: new Map(shapes.map((f) => [f, partsOf(f)])),
  };
}
