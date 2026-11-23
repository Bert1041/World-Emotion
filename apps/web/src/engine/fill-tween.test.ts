import { hexToOklab, oklabToCss } from "@world-emotion/motion";
import { describe, expect, it } from "vitest";
import { FillTween } from "./fill-tween";

const RED = hexToOklab("#d04040");
const BLUE = hexToOklab("#4060d0");
const GREEN = hexToOklab("#40b060");
const map = (entries: [string, ReturnType<typeof hexToOklab>][]) => new Map(entries);
const css = (m: Map<string, ReturnType<typeof hexToOklab>>, code: string) =>
  oklabToCss(m.get(code) as ReturnType<typeof hexToOklab>);

describe("FillTween (Phase 6: colours ease to a new snapshot)", () => {
  it("passes through in-between colours, then lands exactly on the target", () => {
    const tw = new FillTween(1.5);
    tw.colours(map([["CA", RED]])); // on screen
    expect(tw.start(map([["CA", BLUE]]))).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      tw.step(0.1);
      seen.add(css(tw.colours(map([["CA", BLUE]])), "CA"));
    }
    expect(seen.size, "several in-between colours").toBeGreaterThan(5);
    expect(tw.tweening).toBe(false);
    expect(css(tw.colours(map([["CA", BLUE]])), "CA")).toBe(oklabToCss(BLUE));
  });

  it("halfway is neither colour", () => {
    const tw = new FillTween(1);
    tw.colours(map([["CA", RED]]));
    tw.start(map([["CA", BLUE]]));
    tw.step(0.5);
    const mid = css(tw.colours(map([["CA", BLUE]])), "CA");
    expect(mid).not.toBe(oklabToCss(RED));
    expect(mid).not.toBe(oklabToCss(BLUE));
  });

  it("does not start when nothing visibly changes, on the first paint, or under reduced motion", () => {
    const same = new FillTween(1.5);
    same.colours(map([["CA", RED]]));
    expect(same.start(map([["CA", RED]])), "same colours").toBe(false);

    expect(new FillTween(1.5).start(map([["CA", BLUE]])), "nothing on screen yet").toBe(false);

    const reduced = new FillTween(0);
    reduced.colours(map([["CA", RED]]));
    expect(reduced.start(map([["CA", BLUE]])), "reduced motion").toBe(false);
    expect(css(reduced.colours(map([["CA", BLUE]])), "CA")).toBe(oklabToCss(BLUE));
  });

  it("follows a target that moves mid-tween (a theme fade or a zoom) and ends on it", () => {
    const tw = new FillTween(1);
    tw.colours(map([["CA", RED]]));
    tw.start(map([["CA", BLUE]]));
    tw.step(0.5);
    tw.colours(map([["CA", GREEN]])); // the target changed under the tween
    tw.step(0.6);
    expect(css(tw.colours(map([["CA", GREEN]])), "CA")).toBe(oklabToCss(GREEN));
  });
});
