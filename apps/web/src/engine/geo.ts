import { geoCentroid, geoDistance } from "d3-geo";
import type { Feature, FeatureCollection, MultiLineString, Position } from "geojson";
import { feature, mesh } from "topojson-client";

export type LodName = "110m" | "50m";

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
export async function loadLod(name: LodName): Promise<Lod> {
  const raw =
    name === "110m"
      ? (await import("@world-emotion/geo-data/world-110m.topo.json")).default
      : (await import("@world-emotion/geo-data/world-50m.topo.json")).default;
  const topo = asTopology(raw);
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
