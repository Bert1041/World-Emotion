import { geoCentroid, geoDistance } from "d3-geo";
import type { Feature, FeatureCollection, MultiLineString, Position } from "geojson";
import { feature, mesh } from "topojson-client";
import { presimplify, quantile, simplify, sphericalTriangleArea } from "topojson-simplify";

/**
 * "move" is the 110m map simplified further. It is drawn on every animation frame (drag, glide,
 * theme fade), where drawing cost scales with the number of points; "50m" is drawn once on settle.
 */
export type LodName = "move" | "110m" | "50m";

export interface Lod {
  readonly name: LodName;
  /** Features with an ISO code (selectable, coloured by mood). */
  readonly countries: readonly Feature[];
  /** Features without a code (docs/geo-decisions.md G4): neutral, unselectable. */
  readonly neutral: readonly Feature[];
  /** Internal borders as a single mesh: one stroke call per frame. */
  readonly borders: MultiLineString;
  /** Bounding cap per feature (centre + angular radius, radians), for back-face culling. */
  readonly caps: ReadonlyMap<Feature, Cap>;
}

export interface Cap {
  readonly center: [number, number];
  readonly radius: number;
}

/** Smallest-effort bounding cap: centroid plus the farthest vertex. Computed once at load. */
function capOf(f: Feature): Cap {
  const center = geoCentroid(f);
  let radius = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v) && typeof v[0] === "number")
      radius = Math.max(radius, geoDistance(center, v as Position as [number, number]));
    else if (Array.isArray(v)) for (const x of v) walk(x);
  };
  walk((f.geometry as { coordinates?: unknown }).coordinates);
  return { center, radius };
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
  return {
    name,
    countries: fc.features.filter((f) => f.id !== undefined),
    neutral: fc.features.filter((f) => f.id === undefined),
    borders: mesh(topo, obj, (a, b) => a !== b) as MultiLineString,
    caps: new Map(fc.features.map((f) => [f, capOf(f)])),
  };
}
