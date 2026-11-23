import { easeOut, mixOklab, type Oklab } from "@world-emotion/motion";

/**
 * The arrival's colour wave (Phase 6.5, V5): every country starts in the theme's plain land colour
 * and takes on its mood in turn, nearest to your pin first, so the world "lights up" from you.
 * The target is passed in on every frame (like FillTween), so new data mid-wave is followed.
 */
export class FillWave {
  private t = 0;
  private readonly end: number;

  /**
   * @param plain  the land colour every country starts from
   * @param delays seconds before each country starts to change
   * @param each   seconds one country takes once it starts
   */
  constructor(
    private readonly plain: Oklab,
    private readonly delays: ReadonlyMap<string, number>,
    private readonly each: number,
  ) {
    let last = 0;
    for (const d of delays.values()) last = Math.max(last, d);
    this.end = last + each;
  }

  get running(): boolean {
    return this.t < this.end;
  }

  step(dt: number): void {
    this.t = Math.min(this.end, this.t + dt);
  }

  /** Jump to the end (any touch or key during the arrival). */
  finish(): void {
    this.t = this.end;
  }

  /** How far country `code` has gone from plain (0) to its mood (1). Unknown codes: done. */
  progress(code: string): number {
    const d = this.delays.get(code);
    if (d === undefined) return 1;
    return easeOut(Math.min(1, Math.max(0, (this.t - d) / this.each)));
  }

  colours(target: ReadonlyMap<string, Oklab>): Map<string, Oklab> {
    const out = new Map<string, Oklab>();
    for (const [code, lab] of target) out.set(code, mixOklab(this.plain, lab, this.progress(code)));
    return out;
  }
}

/**
 * Delays for the wave: proportional to the great-circle distance from `from` ([lon, lat] degrees)
 * to each country's point, so the far side of the world starts `spread` seconds after your pin.
 */
export function waveDelays(
  from: readonly [number, number],
  points: ReadonlyMap<string, readonly [number, number]>,
  spread: number,
): Map<string, number> {
  const rad = Math.PI / 180;
  const [l0, p0] = [from[0] * rad, from[1] * rad];
  const out = new Map<string, number>();
  for (const [code, [lon, lat]] of points) {
    const [l1, p1] = [lon * rad, lat * rad];
    const c = Math.sin(p0) * Math.sin(p1) + Math.cos(p0) * Math.cos(p1) * Math.cos(l1 - l0);
    const angle = Math.acos(Math.min(1, Math.max(-1, c))); // 0 … π
    out.set(code, (angle / Math.PI) * spread);
  }
  return out;
}
