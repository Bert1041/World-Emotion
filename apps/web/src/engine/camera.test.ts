import { arc, DURATION, FRICTION_PER_SECOND } from "@world-emotion/motion";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Camera, rubberBand, STRETCH_LIMIT, type View } from "./camera";

const START: View = { center: [10, 20], zoom: 1 };
const RAD = Math.PI / 180;

/** Run the camera with the given frame times; returns the rendered view after each frame. */
function drive(cam: Camera, frames: readonly number[]): View[] {
  return frames.map((dt) => {
    cam.update(dt);
    return cam.rendered;
  });
}
const steady = (hz: number, seconds: number) => Array(Math.round(hz * seconds)).fill(1 / hz);
const same = (a: View, b: View) => {
  expect(arc(a.center, b.center) / RAD).toBeLessThan(1e-9);
  expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(1e-12);
};

describe("Camera: frame-rate honesty (README §8.6)", () => {
  it("a fling ends in the same place at 60 Hz, 120 Hz and on uneven frames", () => {
    const ends = [steady(60, 3), steady(120, 3), [...steady(30, 1), ...steady(144, 2)]].map((f) => {
      const cam = new Camera(START);
      cam.fling(120, -40);
      return drive(cam, f).at(-1) as View;
    });
    same(ends[0] as View, ends[1] as View);
    same(ends[0] as View, ends[2] as View);
    expect(arc(START.center, (ends[0] as View).center) / RAD, "it moved").toBeGreaterThan(10);
  });

  it("a glide passes the same views at the same times, at any frame rate", () => {
    const to: View = { center: [-100, 40], zoom: 2.5, offset: [0.2, -0.1] };
    const at60 = (() => {
      const c = new Camera(START);
      c.glideTo(to);
      return drive(c, steady(60, 2));
    })();
    const at120 = (() => {
      const c = new Camera(START);
      c.glideTo(to);
      return drive(c, steady(120, 2));
    })();
    for (const i of [6, 30, 60, 119]) same(at60[i] as View, at120[2 * i + 1] as View);
  });
});

describe("Camera: glide", () => {
  it("takes the glide token's duration and lands exactly on the target", () => {
    const to: View = { center: [100, 35], zoom: 2, offset: [0.1, 0.1] };
    const c = new Camera(START);
    c.glideTo(to);
    drive(c, steady(60, DURATION.glide - 0.1));
    expect(c.gliding, "still gliding just before the token duration").toBe(true);
    drive(c, steady(60, 0.2));
    expect(c.gliding).toBe(false);
    expect(c.view).toEqual(to);
  });

  it("follows the great circle (no detour) and pulls back mid-flight", () => {
    const to: View = { center: [-170, 10], zoom: 1 };
    const c = new Camera(START);
    c.glideTo(to);
    const views = drive(c, steady(60, DURATION.glide + 0.1));
    const total = arc(START.center, to.center);
    for (const v of views)
      expect(arc(START.center, v.center) + arc(v.center, to.center)).toBeCloseTo(total, 9);
    expect(Math.min(...views.map((v) => v.zoom)), "pull-back").toBeLessThan(0.8);
  });
});

describe("Camera: inertia", () => {
  it("slows by FRICTION_PER_SECOND and travels v / ln(1/F) degrees in total", () => {
    const c = new Camera({ center: [0, 0], zoom: 1 });
    c.fling(100, 0);
    drive(c, steady(60, 1));
    // After 1 s the speed is 100·F: measure it over one more short frame.
    const before = c.view.center[0];
    c.update(1 / 60);
    const speed = (c.view.center[0] - before) * 60;
    expect(speed).toBeCloseTo(100 * FRICTION_PER_SECOND, 0);
    drive(c, steady(60, 5));
    expect(c.moving, "stopped").toBe(false);
    const expected = 100 / Math.log(1 / FRICTION_PER_SECOND);
    expect(Math.abs(c.view.center[0] - expected)).toBeLessThan(0.5); // stop cut-off at 1°/s
  });

  it("stop() halts a fling and a glide at once", () => {
    const c = new Camera(START);
    c.fling(200, 0);
    c.update(0.1);
    c.stop();
    const at = c.view;
    drive(c, steady(60, 1));
    expect(c.view).toEqual(at);
    c.glideTo({ center: [50, 0], zoom: 2 });
    c.update(0.2);
    c.stop();
    expect(c.gliding).toBe(false);
  });
});

describe("Camera: zoom stretch (rubber band)", () => {
  it("rubberBand: slope 1 at rest, monotonic, never past the limit", () => {
    expect(rubberBand(1e-6) / 1e-6).toBeCloseTo(1, 4);
    // Elastic, not a hard stop: pulling one full limit moves well under one limit.
    expect(rubberBand(STRETCH_LIMIT)).toBeLessThan(0.7 * STRETCH_LIMIT);
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (x, d) => {
          expect(Math.abs(rubberBand(x))).toBeLessThan(STRETCH_LIMIT + 1e-12);
          expect(rubberBand(x + d)).toBeGreaterThanOrEqual(rubberBand(x) - 1e-12);
        },
      ),
    );
  });

  it("holds while pulled, then springs back to the resting zoom and stops", () => {
    const c = new Camera(START);
    c.holdStretch(5); // a big pinch: resisted
    drive(c, steady(60, 0.5));
    expect(c.rendered.zoom).toBeGreaterThan(1.3);
    expect(c.rendered.zoom).toBeLessThanOrEqual(Math.exp(STRETCH_LIMIT) + 1e-9);
    expect(c.view.zoom, "the resting view is untouched").toBe(1);
    expect(c.releaseStretch()).toBeCloseTo(rubberBand(5), 9);
    drive(c, steady(60, 1));
    expect(c.rendered.zoom).toBe(1);
    expect(c.moving).toBe(false);
  });
});

describe("Camera: reduced motion (README §8.4)", () => {
  it("glides jump, flings do nothing, stretches snap back", () => {
    const c = new Camera(START, { reducedMotion: true });
    const to: View = { center: [100, 30], zoom: 2 };
    c.glideTo(to);
    expect(c.view).toEqual(to);
    expect(c.moving).toBe(false);
    c.fling(300, 0);
    expect(c.moving).toBe(false);
    c.holdStretch(1);
    c.releaseStretch();
    expect(c.rendered.zoom).toBe(2);
    expect(c.moving).toBe(false);
  });
});
