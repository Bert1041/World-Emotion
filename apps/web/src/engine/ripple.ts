import { DURATION, easeOut } from "@world-emotion/motion";

/**
 * Check-in ripple (README §8.2.5): rings in the mood's colour spread from your country across the
 * globe. Pure timeline; main.ts draws each ring as a small circle on the sphere (d3 geoCircle).
 */
export interface Ring {
  /** 0 = the leading ring; later ones are fainter echoes. */
  readonly index: number;
  readonly center: readonly [number, number];
  /** Angular radius on the sphere, degrees. */
  readonly radius: number;
  readonly alpha: number;
  readonly color: string;
}

/** Three rings, a quarter-second apart, reaching a third of the way round the world. */
export const RINGS = 3;
export const RING_STAGGER = 0.25;
export const RING_MAX_DEG = 120;

interface Wave {
  readonly center: readonly [number, number];
  readonly color: string;
  t: number;
}

export class Ripples {
  private waves: Wave[] = [];

  /** Start a ripple at `center` ([lon, lat]). */
  add(center: readonly [number, number], color: string): void {
    this.waves.push({ center, color, t: 0 });
  }

  get active(): boolean {
    return this.waves.length > 0;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    for (const w of this.waves) w.t += dt;
    const end = DURATION.ripple + (RINGS - 1) * RING_STAGGER;
    this.waves = this.waves.filter((w) => w.t < end);
  }

  /** Rings to draw now (started and not yet faded out). */
  rings(): Ring[] {
    const out: Ring[] = [];
    for (const w of this.waves) {
      for (let i = 0; i < RINGS; i++) {
        const p = (w.t - i * RING_STAGGER) / DURATION.ripple;
        if (p <= 0 || p >= 1) continue;
        out.push({
          index: i,
          center: w.center,
          radius: RING_MAX_DEG * easeOut(p),
          alpha: (1 - p) ** 2 * (1 - i * 0.25), // later rings are fainter echoes
          color: w.color,
        });
      }
    }
    return out;
  }
}
