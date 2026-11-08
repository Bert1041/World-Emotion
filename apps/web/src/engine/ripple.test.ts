import { DURATION } from "@world-emotion/motion";
import { describe, expect, it } from "vitest";
import { RING_MAX_DEG, RING_STAGGER, RINGS, Ripples } from "./ripple";

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
