import { geoArea, geoBounds, geoCentroid, geoContains, geoDistance } from "d3-geo";
import type { Feature, MultiPolygon, Polygon } from "geojson";

/**
 * Where a country's pin goes when we only know the country (guessed or searched): a point that is
 * inside the country, on its largest landmass, as close to that landmass's centre as possible.
 *
 * Measured on the 50m map: 39 of 237 countries have a whole-shape centroid outside themselves
 * (France's is in the Atlantic, pulled by French Guiana; island nations' fall in the sea). The
 * largest landmass's centroid fixes 32; crescents and slivers (Vietnam, Haiti, Israel, Vatican,
 * Marshall Islands, Tuvalu, Chagos) need the grid fallback below. Vatican and Tuvalu are zero-area
 * lines in the 50m map (quantisation); nothing is inside them, so their pin sits on the line.
 */
export function pinPoint(f: Feature): [number, number] {
  const g = f.geometry as Polygon | MultiPolygon | null;
  let land: Polygon | null = g?.type === "Polygon" ? g : null;
  if (g?.type === "MultiPolygon") {
    let bestArea = -1;
    for (const coordinates of g.coordinates) {
      const p: Polygon = { type: "Polygon", coordinates };
      const a = geoArea(p);
      if (a > bestArea) {
        bestArea = a;
        land = p;
      }
    }
  }
  if (land === null) return geoCentroid(f);
  const center = geoCentroid(land);
  if (geoContains(land, center)) return center;
  // Fallback: the inside point of a fine grid over the landmass that is nearest its centre.
  const [[w, s], [e, n]] = geoBounds(land);
  const span = e >= w ? e - w : e + 360 - w; // crosses the antimeridian when e < w
  const N = 40;
  let best: [number, number] | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p: [number, number] = [w + (span * i) / N, s + ((n - s) * j) / N];
      if (!geoContains(land, p)) continue;
      const d = geoDistance(p, center);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best ?? center;
}
