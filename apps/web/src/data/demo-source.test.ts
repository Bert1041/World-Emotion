import { describe, expect, it } from "vitest";
import { DemoSource } from "./demo-source";

/** Snapshots are new objects per run, so identity tells runs apart. */
describe("DemoSource on the frame clock", () => {
  it("steps once per stepMs, not every frame", () => {
    const s = new DemoSource({ stepMs: 2000, autoCycle: false });
    const first = s.snapshot;
    expect(s.tick(16)).toBeNull();
    expect(s.tick(1999)).toBeNull();
    expect(s.tick(2000), "boundary is exclusive, as the loop was").toBeNull();
    const next = s.tick(2001);
    expect(next).not.toBeNull();
    expect(next).not.toBe(first);
    expect(s.snapshot).toBe(next);
    expect(s.tick(2500), "no second run until another stepMs").toBeNull();
    expect(s.tick(4002)).not.toBeNull();
  });

  it("never steps on its own when paused, but aggregate() still runs", () => {
    const s = new DemoSource({ paused: true });
    const first = s.snapshot;
    expect(s.tick(10_000)).toBeNull();
    expect(s.aggregate()).not.toBe(first);
  });

  it("rotates the world's mood every cycleMs while auto-cycling, and stops on previewMood", () => {
    const s = new DemoSource({ stepMs: 100, cycleMs: 1000, autoCycle: true, now: 0 });
    const headline = () => s.snapshot.world.h;
    const h0 = headline();
    // Runs before the cycle boundary keep the bias; the one after it moves on. The headline has
    // hysteresis, so advance through enough runs for the new bias to win.
    for (let t = 101; t < 1000; t += 101) s.tick(t);
    expect(headline(), "no rotation inside the first cycle").toBe(h0);
    for (let t = 1001; t < 1900; t += 101) s.tick(t);
    expect(headline(), "bias moved after cycleMs").not.toBe(h0);

    expect(s.demo.autoCycle).toBe(true);
    s.demo.previewMood(h0);
    expect(s.demo.autoCycle).toBe(false);
    for (let t = 2001; t < 6000; t += 101) s.tick(t);
    expect(headline(), "previewMood steers back and holds").toBe(h0);
  });

  it("toggleAuto flips the rotation and reports the new state", () => {
    const s = new DemoSource({ autoCycle: false });
    expect(s.demo.autoCycle).toBe(false);
    expect(s.demo.toggleAuto()).toBe(true);
    expect(s.demo.autoCycle).toBe(true);
    expect(s.demo.toggleAuto()).toBe(false);
  });

  it("counts a check-in from the next run, exactly once", () => {
    const a = new DemoSource({ stepMs: 100, autoCycle: false });
    const b = new DemoSource({ stepMs: 100, autoCycle: false });
    a.checkIn("NG", 2);
    expect(a.snapshot.world.n, "not before a run").toBe(b.snapshot.world.n);
    a.tick(101);
    b.tick(101);
    expect(a.snapshot.world.n - b.snapshot.world.n).toBe(1);
  });
});
