import { geoBounds, geoContains } from "d3-geo";
import type { Feature } from "geojson";
import { pinPoint } from "./pin";

/**
 * Points on a country's land, for mood weather to rise from (bridge U2). Before this, weather
 * spawned at the whole-shape centroid plus up to 4° of jitter, and 39 of 237 countries have that
 * centroid outside themselves (France's is in the Atlantic, island nations' in the sea; pin.ts),
 * so particles drifted over open ocean.
 *
 * Rejection sampling over the country's bounding box: points land in proportion to area, across
 * all its landmasses. Countries too small or thin to hit in `tries` fall back to the pin point,
 * which is always inside (or on the line, for zero-area shapes). Flat [lon, lat, lon, lat, …].
 *
 * Cost (measured 2026-11-11, 50m map, laptop): ~210 ms for all 237 countries at 12 tries per
 * point, the slowest single country ~13 ms (Chile: a thin coast in a wide box). 25 tries cost
 * twice as much for 3 % more real samples. The app spreads the work one country per idle slice.
 */
export function landSamples(
  f: Feature,
  k: number,
  random: () => number,
  tries = k * 12,
): Float32Array {
  const out = new Float32Array(k * 2);
  const [[w, s], [e, n]] = geoBounds(f);
  const span = e >= w ? e - w : e + 360 - w; // crosses the antimeridian when e < w
  let found = 0;
  for (let t = 0; t < tries && found < k; t++) {
    let lon = w + random() * span;
    if (lon > 180) lon -= 360;
    // Uniform in area, not in latitude: sample sin(lat).
    const s0 = Math.sin((s * Math.PI) / 180);
    const s1 = Math.sin((n * Math.PI) / 180);
    const lat = (Math.asin(s0 + random() * (s1 - s0)) * 180) / Math.PI;
    if (!geoContains(f, [lon, lat])) continue;
    out[found * 2] = lon;
    out[found * 2 + 1] = lat;
    found++;
  }
  if (found < k) {
    const [plon, plat] = pinPoint(f);
    for (let i = found; i < k; i++) {
      out[i * 2] = plon;
      out[i * 2 + 1] = plat;
    }
  }
  return out;
}
