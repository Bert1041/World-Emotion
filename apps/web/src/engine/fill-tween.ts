import { easeInOutCubic, mixOklab, type Oklab, oklabToCss } from "@world-emotion/motion";

/**
 * Country colours easing to a new snapshot (docs/design/phase-6-live-data.md §3). Before this,
 * fills jumped: invisible at the demo's 2 s steps, a visible snap at real 5-minute steps.
 *
 * The target is passed in on every frame rather than fixed at the start, so a theme cross-fade or
 * a zoom that lands mid-tween is followed, not overwritten when the tween ends.
 */
export class FillTween {
  /** What is on screen now. */
  private shown = new Map<string, Oklab>();
  private from: Map<string, Oklab> | null = null;
  private t = 1;

  /** `seconds` 0 means no tween (reduced motion). */
  constructor(private readonly seconds: number) {}

  /**
   * A new snapshot. Tweens from what is on screen, but only if some colour visibly changes:
   * fills are quantised, so most snapshots change nothing, and a tween redraws the base layer on
   * every frame (in the light map) for its whole length.
   */
  start(target: ReadonlyMap<string, Oklab>): boolean {
    if (this.seconds === 0 || this.shown.size === 0 || sameColours(this.shown, target))
      return false;
    this.from = new Map(this.shown);
    this.t = 0;
    return true;
  }

  get tweening(): boolean {
    return this.from !== null && this.t < 1;
  }

  /** Advance by `dt` seconds. Returns whether the tween is still running. */
  step(dt: number): boolean {
    if (this.from === null) return false;
    this.t = Math.min(1, this.t + dt / this.seconds);
    if (this.t >= 1) this.from = null;
    return this.from !== null;
  }

  /** The colours to draw now, given the current target. */
  colours(target: ReadonlyMap<string, Oklab>): Map<string, Oklab> {
    const from = this.from;
    const out = new Map<string, Oklab>();
    if (from === null) for (const [code, lab] of target) out.set(code, lab);
    else {
      const k = easeInOutCubic(this.t);
      for (const [code, lab] of target) {
        const was = from.get(code);
        out.set(code, was === undefined ? lab : mixOklab(was, lab, k));
      }
    }
    this.shown = out;
    return out;
  }
}

/** Equal as drawn: compared as CSS, so float noise below what the screen shows does not count. */
function sameColours(a: ReadonlyMap<string, Oklab>, b: ReadonlyMap<string, Oklab>): boolean {
  if (a.size !== b.size) return false;
  for (const [code, lab] of b) {
    const other = a.get(code);
    if (other === undefined || oklabToCss(other) !== oklabToCss(lab)) return false;
  }
  return true;
}
