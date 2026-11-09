import { describe, expect, it } from "vitest";
import { cubicBezier, easeInOutCubic, easeOut } from "./ease";

describe("easing", () => {
  it("CSS `ease` matches the browser's reference value", () => {
    // cubic-bezier(.25,.1,.25,1) at x = 0.5 is 0.8024033877399112 (WebKit UnitBezier).
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024034, 5);
  });

  it("linear bezier is the identity", () => {
    const lin = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(lin(x)).toBeCloseTo(x, 6);
  });

  it("curves hit the endpoints, clamp outside [0,1], and never go backwards", () => {
    for (const f of [easeOut, easeInOutCubic, cubicBezier(0.7, 0, 0.3, 1)]) {
      expect([f(0), f(1), f(-2), f(3)]).toEqual([0, 1, 0, 1]);
      let prev = 0;
      for (let i = 1; i <= 200; i++) {
        const y = f(i / 200);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
  });

  it("easeOut is front-loaded (most of the motion early)", () => {
    expect(easeOut(0.25)).toBeGreaterThan(0.6);
  });
});
