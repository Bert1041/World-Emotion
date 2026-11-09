import { DURATION } from "@world-emotion/motion";
import { type GeoPath, geoOrthographic, geoPath } from "d3-geo";
import { describe, expect, it } from "vitest";
import { RING_MAX_DEG, RING_STAGGER, RINGS, Ripples, ringOutline } from "./ripple";

const run = (r: Ripples, seconds: number, hz = 60) => {
  const out: ReturnType<Ripples["rings"]>[] = [];
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    r.update(1 / hz);
    out.push(r.rings());
  }
  return out;
};

describe("Ripples", () => {
  it("each ring grows outward and fades, never backwards", () => {
    const r = new Ripples();
    r.add([3, 9], "#fff");
    const frames = run(r, DURATION.ripple + RINGS * RING_STAGGER);
    const first = frames.map((f) => f.find((x) => x.index === 0)).filter((x) => x !== undefined);
    for (let i = 1; i < first.length; i++) {
      expect((first[i] as { radius: number }).radius).toBeGreaterThanOrEqual(
        (first[i - 1] as { radius: number }).radius,
      );
    }
    expect(Math.max(...first.map((x) => x?.radius ?? 0))).toBeGreaterThan(RING_MAX_DEG * 0.95);
    expect(Math.max(...first.map((x) => x?.radius ?? 0))).toBeLessThanOrEqual(RING_MAX_DEG);
    expect(first[0]?.alpha).toBeGreaterThan(0.9);
    expect(first.at(-1)?.alpha).toBeLessThan(0.05);
  });

  it("staggers its rings and cleans up after the last one", () => {
    const r = new Ripples();
    r.add([0, 0], "#fff");
    r.update(RING_STAGGER / 2);
    expect(r.rings()).toHaveLength(1);
    r.update(RING_STAGGER * (RINGS - 1));
    expect(r.rings()).toHaveLength(RINGS);
    r.update(DURATION.ripple + RINGS * RING_STAGGER);
    expect(r.rings()).toHaveLength(0);
    expect(r.active, "finished ripples are dropped").toBe(false);
  });

  it("is frame-rate independent", () => {
    const a = new Ripples();
    const b = new Ripples();
    a.add([0, 0], "#fff");
    b.add([0, 0], "#fff");
    const fa = run(a, 1, 60).at(-1);
    const fb = run(b, 1, 120).at(-1);
    expect(fa?.map((x) => x.radius.toFixed(9))).toEqual(fb?.map((x) => x.radius.toFixed(9)));
  });
});

describe("ringOutline", () => {
  const R = 400;
  /** Points a d3 path emits for a shape, and how many of them lie on the globe's rim. */
  function trace(shape: Parameters<GeoPath>[0], view: [number, number]) {
    const proj = geoOrthographic()
      .clipAngle(90)
      .precision(0)
      .scale(R)
      .translate([0, 0])
      .rotate([-view[0], -view[1]]);
    let points = 0;
    let onRim = 0;
    const visit = (x: number, y: number) => {
      points++;
      if (Math.abs(Math.hypot(x, y) - R) < 0.5) onRim++;
    };
    geoPath(proj, {
      moveTo: visit,
      lineTo: visit,
      closePath() {},
      arc() {},
    } as unknown as CanvasRenderingContext2D)(shape);
    return { points, onRim };
  }
  const nigeria: [number, number] = [8, 9.6];

  it("past 90°, seen from its centre (the camera at check-in), draws nothing, not the rim", () => {
    for (const r of [91, 100, RING_MAX_DEG])
      expect(trace(ringOutline(nigeria, r), nigeria)).toEqual({ points: 0, onRim: 0 });
  });

  it("inside 90°, the whole ring is drawn, and none of it on the rim", () => {
    for (const r of [10, 45, 80]) {
      const t = trace(ringOutline(nigeria, r), nigeria);
      expect(t.points).toBeGreaterThan(80);
      expect(t.onRim).toBe(0);
    }
  });

  it("crossing the horizon from the side: only the visible arc, never a rim segment", () => {
    // Seen from 90° away the ring of radius 60 is half in front, half behind.
    const t = trace(ringOutline(nigeria, 60), [98, 9.6]);
    expect(t.points).toBeGreaterThan(10);
    // Only arc ends meet the horizon (two crossings; the ring's start point can split one arc in
    // two, so up to four ends), never a stroke along it (the polygon put ~180 points there).
    expect(t.onRim).toBeLessThanOrEqual(4);
  });
});
