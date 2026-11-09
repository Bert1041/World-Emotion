import { geoDistance, geoRotation } from "d3-geo";

/**
 * Day/night band (README §8.2.7, decision M3): the night side of the globe, darkening smoothly
 * through twilight, from sunset (sun 0° below the horizon) to the end of astronomical twilight
 * (18° below), then full night. Nothing on the day side is darkened.
 *
 * Drawn per pixel, not as shapes: in an orthographic view a point's darkness depends only on its
 * angle from the sun, a dot product with the point's position on the sphere. A small grid of those
 * (NIGHT_GRID²) is scaled up with smoothing and clipped to the globe. The first version stacked 13
 * small circles; projecting and clipping them cost ~0.65 ms a frame on an M2 (~2.9 ms at 4× CPU
 * throttle, docs/bench/2026-11-09-desktop-phase4.json), and 4 coarser circles showed as stripes.
 */
export const TWILIGHT_DEG = 18;
/** Darkening in full night (about a third, so land stays legible). */
export const NIGHT_FULL = 0.31;
/** Grid size of the shade texture (a smooth function, so a coarse grid scales up cleanly). */
export const NIGHT_GRID = 96;
/** The shade colour: deep blue-black, so night reads as shadow on every theme. */
export const NIGHT_RGB = [2, 5, 16] as const;

const DEG = Math.PI / 180;

/** The point opposite `p` on the sphere ([lon, lat], degrees). */
export function antipode([lon, lat]: readonly [number, number]): [number, number] {
  return [lon > 0 ? lon - 180 : lon + 180, -lat];
}

/** Darkening (0 … NIGHT_FULL) where the sun is `fromSun` degrees away (90° = on the horizon). */
export function nightDarkness(fromSun: number): number {
  const f = Math.min(1, Math.max(0, (fromSun - 90) / TWILIGHT_DEG));
  // Each degree of twilight multiplies the remaining light by the same factor: no visible edge.
  return 1 - (1 - NIGHT_FULL) ** f;
}

/** The tests' oracle: darkening at a lon/lat for a given sub-solar point. */
export function nightAt(p: readonly [number, number], sun: readonly [number, number]): number {
  return nightDarkness(geoDistance([p[0], p[1]], [sun[0], sun[1]]) / DEG);
}

/**
 * The sun's direction in view space for a d3 orthographic projection rotated by `rotate`:
 * x right, y down (screen), z towards the viewer, unit length.
 */
export function sunInView(
  sun: readonly [number, number],
  rotate: [number, number, number],
): [number, number, number] {
  const [lon, lat] = geoRotation(rotate)([sun[0], sun[1]]);
  const c = Math.cos(lat * DEG);
  return [c * Math.sin(lon * DEG), -Math.sin(lat * DEG), c * Math.cos(lon * DEG)];
}

/**
 * Shade alpha (0–255) by the cosine of the angle to the sun, for cos in [-1, 0] (the day side,
 * cos > 0, is never shaded): ALPHA_BY_COS[k] is for cos = -k / LUT_STEPS. Replaces an acos and a
 * fractional power per texel; a step is ≤ 0.015° of arc, far under one alpha level.
 */
const LUT_STEPS = 4096;
const ALPHA_BY_COS = Uint8Array.from({ length: LUT_STEPS + 1 }, (_, k) =>
  Math.round(255 * nightDarkness(Math.acos(-k / LUT_STEPS) / DEG)),
);

/** Texel box [i0, j0, i1, j1] (inclusive) holding every shaded texel. */
export type ShadeBox = [number, number, number, number];

/**
 * Fill an RGBA grid (size × size) covering the globe's bounding square with the night shade, and
 * return the box of shaded texels (null if none) so only that part is drawn: blending the whole
 * globe every frame doubled frame time without a GPU (50 → 100 ms at 2560 px wide; CI 2026-11-09).
 * Texels outside the disk take the value at the nearest edge point, so smoothing never pulls in a
 * wrong value at the rim (the drawn image is clipped to the disk anyway).
 */
export function shadeNight(
  out: Uint8ClampedArray,
  size: number,
  s: readonly [number, number, number],
): ShadeBox | null {
  const [r, g, b] = NIGHT_RGB;
  let i0 = size;
  let j0 = size;
  let i1 = -1;
  let j1 = -1;
  for (let j = 0; j < size; j++) {
    const v0 = ((j + 0.5) / size) * 2 - 1;
    for (let i = 0; i < size; i++) {
      let u = ((i + 0.5) / size) * 2 - 1;
      let v = v0;
      const d2 = u * u + v * v;
      let z = 0;
      if (d2 >= 1) {
        const k = 1 / Math.sqrt(d2);
        u *= k;
        v *= k;
      } else z = Math.sqrt(1 - d2);
      const cos = u * s[0] + v * s[1] + z * s[2];
      const o = (j * size + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      const alpha =
        cos >= 0 ? 0 : (ALPHA_BY_COS[Math.min(LUT_STEPS, Math.round(-cos * LUT_STEPS))] as number);
      out[o + 3] = alpha;
      if (alpha > 0) {
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
  }
  return i1 < 0 ? null : [i0, j0, i1, j1];
}
