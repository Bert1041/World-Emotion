import { subsolarPoint } from "@world-emotion/motion";
import { geoDistance, geoOrthographic, geoRotation } from "d3-geo";
import { describe, expect, it } from "vitest";
import {
  antipode,
  NIGHT_FULL,
  NIGHT_RGB,
  nightAt,
  nightDarkness,
  shadeNight,
  sunInView,
  TWILIGHT_DEG,
} from "./night";

const deg = (a: readonly [number, number], b: readonly [number, number]) =>
  (geoDistance([a[0], a[1]], [b[0], b[1]]) * 180) / Math.PI;

describe("antipode", () => {
  it.each([
    [
      [0, 0],
      [180, 0],
    ],
    [
      [10, 20],
      [-170, -20],
    ],
    [
      [-10, -20],
      [170, 20],
    ],
    [
      [180, 5],
      [0, -5],
    ],
    [
      [-180, 5],
      [0, -5],
    ],
  ] as const)("%j → %j", (p, q) => {
    const a = antipode(p);
    expect(a[0]).toBeCloseTo(q[0], 9);
    expect(a[1]).toBeCloseTo(q[1], 9);
    expect(deg(p, a)).toBeCloseTo(180, 6);
  });
});

describe("night darkness through twilight", () => {
  it.each([
    // [degrees from the sub-solar point, darkening]
    [0, 0],
    [60, 0], // afternoon
    [90, 0], // sun on the horizon: not yet dark
    [90 + TWILIGHT_DEG / 2, 1 - Math.sqrt(1 - NIGHT_FULL)], // mid twilight: half the light loss
    [90 + TWILIGHT_DEG, NIGHT_FULL], // astronomical twilight over
    [150, NIGHT_FULL],
    [180, NIGHT_FULL],
  ])("%s° from the sun → %s", (d, dark) => {
    expect(nightDarkness(d)).toBeCloseTo(dark, 9);
  });

  it("deepens without a step anywhere (no visible edge)", () => {
    let prev = 0;
    for (let d = 0; d <= 180; d += 0.05) {
      const x = nightDarkness(d);
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x - prev, `${d}°`).toBeLessThan(0.002); // well under one 8-bit level per 0.05°
      prev = x;
    }
  });

  it("is centred opposite the sun (March 2026 equinox, 12:00 UTC)", () => {
    const sun = subsolarPoint(Date.UTC(2026, 2, 20, 12));
    expect(deg(sun, [0, 0])).toBeLessThan(2);
    expect(nightAt(sun, sun)).toBe(0);
    expect(nightAt(antipode(sun), sun)).toBeCloseTo(NIGHT_FULL, 9);
    // A point exactly 100° east of the sun: 10° into twilight.
    const p = geoRotation([-sun[0], -sun[1]]).invert([100, 0]) as [number, number];
    expect(nightAt(p, sun)).toBeCloseTo(nightDarkness(100), 9);
  });
});

describe("the shade texture agrees with the oracle, in any view", () => {
  const SIZE = 48;
  // Several views and suns, including the sun behind the globe and on the limb.
  const cases: { rotate: [number, number, number]; sun: [number, number] }[] = [
    { rotate: [0, 0, 0], sun: [0, 0] },
    { rotate: [90, 0, 0], sun: [0, 0] },
    { rotate: [-30, -40, 0], sun: [120, 23.4] },
    { rotate: [150, 60, 0], sun: [-75, -23.4] },
    { rotate: [10, -20, 0], sun: [-170, 5] },
  ];
  it.each(cases)("rotate $rotate, sun $sun", ({ rotate, sun }) => {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    shadeNight(out, SIZE, sunInView(sun, rotate));
    const proj = geoOrthographic().rotate(rotate).scale(1).translate([0, 0]).clipAngle(90);
    let checked = 0;
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const u = ((i + 0.5) / SIZE) * 2 - 1;
        const v = ((j + 0.5) / SIZE) * 2 - 1;
        if (u * u + v * v > 0.98) continue; // the rim is clamped on purpose
        const lonLat = proj.invert?.([u, v]) as [number, number];
        const o = (j * SIZE + i) * 4;
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([...NIGHT_RGB]);
        const want = Math.round(255 * nightAt(lonLat, sun));
        expect(Math.abs((out[o + 3] as number) - want), `texel ${i},${j}`).toBeLessThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(SIZE * SIZE * 0.7);
  });
});
