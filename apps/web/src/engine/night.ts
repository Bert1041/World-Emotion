import { geoCircle, geoDistance } from "d3-geo";
import type { Polygon } from "geojson";

/**
 * Day/night band (README §8.2.7, decision M3): the night side of the globe, shaded in fine steps so
 * the terminator fades instead of cutting. Each step is a small circle around the point opposite
 * the sun. The steps span twilight: from sunset (the sun 0° below the horizon, a 90° circle) to the
 * end of astronomical twilight (18° below, 72°), so the shade deepens as the sky really darkens.
 * Nothing on the day side is darkened. Four coarse steps were tried first and showed as stripes.
 */
export const TWILIGHT_DEG = 18;
export const NIGHT_STEP_COUNT = 13;
/** Angular radius of each step around the anti-solar point, widest first: 90°, 88.5°, … 72°. */
export const NIGHT_STEPS: readonly number[] = Array.from(
  { length: NIGHT_STEP_COUNT },
  (_, i) => 90 - (i * TWILIGHT_DEG) / (NIGHT_STEP_COUNT - 1),
);
/** Darkening in full night (about a third, so land stays legible). */
export const NIGHT_FULL = 0.31;
/** Per-step alpha so the stacked steps add up to NIGHT_FULL (about 2.8% each). */
export const NIGHT_STEP_ALPHA = 1 - (1 - NIGHT_FULL) ** (1 / NIGHT_STEP_COUNT);

/** The point opposite `p` on the sphere ([lon, lat], degrees). */
export function antipode([lon, lat]: readonly [number, number]): [number, number] {
  return [lon > 0 ? lon - 180 : lon + 180, -lat];
}

/** The step shapes for a sub-solar point, widest first (drawn as stacked translucent fills). */
export function nightShapes(sun: readonly [number, number]): Polygon[] {
  const center = antipode(sun);
  return NIGHT_STEPS.map((radius) => geoCircle().center(center).radius(radius).precision(2)());
}

/** How many steps cover `p` (0 in daylight, all of them in full night): the tests' oracle. */
export function nightDepth(p: readonly [number, number], sun: readonly [number, number]): number {
  const d = (geoDistance([p[0], p[1]], antipode(sun)) * 180) / Math.PI;
  return NIGHT_STEPS.filter((radius) => d < radius).length;
}
