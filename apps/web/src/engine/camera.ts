import {
  arc,
  DURATION,
  easeInOutCubic,
  FixedStep,
  FRICTION_PER_SECOND,
  SPRING,
  Spring,
  slerp,
} from "@world-emotion/motion";
import type { Continent } from "@world-emotion/shared";

export interface View {
  /** [lon, lat] at the centre of the projection, degrees. */
  readonly center: [number, number];
  /** 1 = whole globe fits the free area. */
  readonly zoom: number;
  /**
   * Where the region's centre sits relative to the projection centre, in base-radius units
   * (from layout.fitRegion). Lets the region, not the sphere, be centred in the free area.
   */
  readonly offset?: [number, number];
}

/**
 * Hand-drawn continent framing: a centre to rotate to and a lon/lat box to fit on screen. Not
 * computed from shapes: France's shape includes French Guiana and Russia's reaches the Pacific,
 * so shape bounds would frame Europe as half the planet.
 */
export interface ContinentFrame {
  readonly center: [number, number];
  /** [[west, south], [east, north]], degrees. */
  readonly box: readonly [readonly [number, number], readonly [number, number]];
}

export const CONTINENT_VIEWS: Readonly<Record<Continent, ContinentFrame>> = {
  AF: {
    center: [17, 2],
    box: [
      [-19, -36],
      [52, 38],
    ],
  },
  AN: {
    center: [0, -90],
    box: [
      [-180, -90],
      [180, -62],
    ],
  },
  AS: {
    center: [88, 30],
    box: [
      [26, -11],
      [148, 56],
    ],
  },
  EU: {
    center: [12, 53],
    box: [
      [-25, 35],
      [42, 71],
    ],
  },
  NA: {
    center: [-100, 44],
    box: [
      [-168, 7],
      [-53, 72],
    ],
  },
  OC: {
    center: [148, -24],
    box: [
      [112, -48],
      [180, 0],
    ],
  },
  SA: {
    center: [-60, -20],
    box: [
      [-82, -56],
      [-34, 13],
    ],
  },
};

/** Rubber band: how far a zoom gesture can stretch (natural log of the zoom factor). */
export const STRETCH_LIMIT = 0.35;
/** Release past this stretch (log zoom ≈ ×1.25 / ×0.8) commits to the next level. */
export const STRETCH_COMMIT = 0.22;

/** Elastic resistance: the further you pull, the less it moves; never past ±STRETCH_LIMIT. */
export function rubberBand(raw: number, limit = STRETCH_LIMIT): number {
  return Math.sign(raw) * limit * (1 - Math.exp(-Math.abs(raw) / limit));
}

/**
 * Camera (README §8.2.2, §8.2.6). Everything moves on the fixed step (packages/motion), so a
 * glide, a fling or a stretch ends in the same place at 60 Hz, 120 Hz or on uneven frames:
 * - glide: the centre follows a great circle while the zoom eases; long flights pull back
 *   mid-way so the move reads as a flight, not a jump;
 * - inertia: a released drag keeps spinning and slows by FRICTION_PER_SECOND;
 * - stretch: a zoom gesture's rubber band, sprung back to rest on release.
 * With `reducedMotion` (README §8.4) nothing animates: glides jump, flings stop, stretches snap.
 */
export class Camera {
  view: View;
  private readonly stepper = new FixedStep();
  private glide: {
    from: View;
    to: View;
    t: number;
    duration: number;
    path: (t: number) => [number, number];
    pull: number;
  } | null = null;
  /** Fling velocity, degrees/second (lon, lat). */
  private spin: [number, number] = [0, 0];
  private readonly stretchSpring = new Spring(0, SPRING.snappy);
  private stretchHeld = false;

  private readonly reducedMotion: boolean;

  constructor(view: View, opts: { reducedMotion?: boolean } = {}) {
    this.view = view;
    this.reducedMotion = opts.reducedMotion ?? false;
  }

  get gliding(): boolean {
    return this.glide !== null;
  }

  /** Anything still in motion (glide, inertia or a stretch springing back). */
  get moving(): boolean {
    return (
      this.glide !== null ||
      this.spin[0] !== 0 ||
      this.spin[1] !== 0 ||
      this.stretchHeld ||
      !this.stretchSpring.settled(1e-4)
    );
  }

  /** The view to draw: the resting view with the zoom stretched by the rubber band. */
  get rendered(): View {
    const s = this.stretchSpring.value;
    return s === 0 ? this.view : { ...this.view, zoom: this.view.zoom * Math.exp(s) };
  }

  glideTo(to: View, duration: number = DURATION.glide): void {
    const from = this.view;
    this.spin = [0, 0];
    if (this.reducedMotion) {
      this.view = to;
      this.glide = null;
      return;
    }
    this.glide = {
      from,
      to,
      t: 0,
      duration,
      path: slerp(from.center, to.center),
      pull: Math.min(0.35, arc(from.center, to.center) / Math.PI), // up to 35% on a half-world flight
    };
  }

  /** Cancel any glide and spin (the user grabbed the globe). */
  stop(): void {
    this.glide = null;
    this.spin = [0, 0];
  }

  /** Release a drag with this velocity (degrees/second); friction slows it. */
  fling(dLonPerS: number, dLatPerS: number): void {
    this.spin = this.reducedMotion ? [0, 0] : [dLonPerS, dLatPerS];
  }

  /** A zoom gesture is pulling: `raw` is the natural log of the gesture's zoom factor. */
  holdStretch(raw: number): void {
    this.stretchHeld = true;
    this.stretchSpring.value = rubberBand(raw);
    this.stretchSpring.velocity = 0;
  }

  /** The gesture let go: returns the stretch reached (to decide on a commit) and springs back. */
  releaseStretch(): number {
    this.stretchHeld = false;
    const s = this.stretchSpring.value;
    if (this.reducedMotion) this.stretchSpring.snap();
    return s;
  }

  /** Advance by frame time `dt` (s); returns true if the rendered view changed. */
  update(dt: number): boolean {
    const was = this.moving;
    this.stepper.advance(dt, (h) => this.step(h));
    if (this.stretchSpring.settled(1e-4) && !this.stretchHeld) this.stretchSpring.snap();
    return was;
  }

  private step(h: number): void {
    const g = this.glide;
    if (g !== null) {
      g.t = Math.min(1, g.t + h / g.duration);
      const e = easeInOutCubic(g.t);
      const zoom =
        (g.from.zoom + (g.to.zoom - g.from.zoom) * e) * (1 - g.pull * Math.sin(Math.PI * e));
      const [fx, fy] = g.from.offset ?? [0, 0];
      const [tx, ty] = g.to.offset ?? [0, 0];
      this.view = { center: g.path(e), zoom, offset: [fx + (tx - fx) * e, fy + (ty - fy) * e] };
      if (g.t >= 1) {
        this.view = g.to;
        this.glide = null;
      }
    } else if (this.spin[0] !== 0 || this.spin[1] !== 0) {
      this.pan(this.spin[0] * h, this.spin[1] * h);
      const k = FRICTION_PER_SECOND ** h;
      this.spin = [this.spin[0] * k, this.spin[1] * k];
      if (Math.hypot(this.spin[0], this.spin[1]) < 1) this.spin = [0, 0]; // under 1°/s: stop
    }
    if (!this.stretchHeld) this.stretchSpring.step(h);
  }

  /** Rotate by a drag, in degrees; latitude clamped so the globe never flips. */
  pan(dLon: number, dLat: number): void {
    const [lon, lat] = this.view.center;
    // Spread keeps zoom and offset; ±89.9 lets Antarctica be viewed from the pole.
    this.view = { ...this.view, center: [lon + dLon, Math.max(-89.9, Math.min(89.9, lat + dLat))] };
  }
}
