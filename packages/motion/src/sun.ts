/**
 * Sub-solar point (README §8.2.7 day/night band): where the sun is overhead at a given time.
 * The Astronomical Almanac's low-precision solar coordinates (about 0.01° for 1950–2050), plus
 * Greenwich mean sidereal time. Pure: time is passed in as unix milliseconds.
 */

const RAD = Math.PI / 180;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** [lon, lat] in degrees of the point where the sun is at the zenith. */
export function subsolarPoint(unixMs: number): [number, number] {
  const n = unixMs / 86_400_000 + 2_440_587.5 - 2_451_545; // days since J2000.0
  const L = 280.46 + 0.9856474 * n; // mean longitude
  const g = (357.528 + 0.9856003 * n) * RAD; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD; // obliquity
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * n;
  return [wrap180(ra - gmst), decl / RAD];
}
