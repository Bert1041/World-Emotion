/** Great-circle maths on [lon, lat] in degrees (README §8.2.6: the camera flies, never cuts). */

const RAD = Math.PI / 180;
type LonLat = readonly [number, number];

const toVec = ([lon, lat]: LonLat): [number, number, number] => {
  const l = lon * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};

const toLonLat = ([x, y, z]: readonly [number, number, number]): [number, number] => [
  Math.atan2(y, x) / RAD,
  Math.atan2(z, Math.hypot(x, y)) / RAD,
];

/**
 * Angle between two points, radians. atan2(|a×b|, a·b) is accurate at every distance, including
 * near-antipodal points where haversine (and d3's geoDistance) lose precision.
 */
export function arc(a: LonLat, b: LonLat): number {
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz);
}

/**
 * Point `t` of the way along the shorter great circle from `a` to `b` (slerp). Exact antipodes
 * have no unique path; one is chosen deterministically.
 */
export function slerp(a: LonLat, b: LonLat): (t: number) => [number, number] {
  const d = arc(a, b);
  const va = toVec(a);
  const vb = toVec(b);
  const s = Math.sin(d);
  if (d < 1e-6) {
    // Tiny arc (under ~6 m on Earth): blend the vectors directly. sin(d) is tiny here too, which
    // must never be mistaken for the antipodal case below.
    return (t: number) =>
      toLonLat([
        va[0] + (vb[0] - va[0]) * t,
        va[1] + (vb[1] - va[1]) * t,
        va[2] + (vb[2] - va[2]) * t,
      ]);
  }
  if (s < 1e-9) {
    // Antipodal: go via the point 90° east of `a` on its latitude circle's great circle.
    const mid = toVec([a[0] + 90, 0]);
    return (t: number) => {
      const th = t * Math.PI;
      return toLonLat([
        va[0] * Math.cos(th) + mid[0] * Math.sin(th),
        va[1] * Math.cos(th) + mid[1] * Math.sin(th),
        va[2] * Math.cos(th) + mid[2] * Math.sin(th),
      ]);
    };
  }
  return (t: number) => {
    const ka = Math.sin((1 - t) * d) / s;
    const kb = Math.sin(t * d) / s;
    return toLonLat([va[0] * ka + vb[0] * kb, va[1] * ka + vb[1] * kb, va[2] * ka + vb[2] * kb]);
  };
}
