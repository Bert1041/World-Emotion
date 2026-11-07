import { easeInOutCubic } from "@world-emotion/motion";
import type { Continent } from "@world-emotion/shared";
import { geoDistance, geoInterpolate } from "d3-geo";

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

export const CONTINENT_NAMES: Readonly<Record<Continent, string>> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

/**
 * Camera with a drill-down glide (README §8.2.6): the centre moves along a great circle while the
 * zoom eases; long flights pull back slightly mid-way so the move reads as a flight, not a jump.
 */
export class Camera {
  view: View;
  private glide: {
    from: View;
    to: View;
    t: number;
    duration: number;
    path: (t: number) => [number, number];
    pull: number;
  } | null = null;

  constructor(view: View) {
    this.view = view;
  }

  get gliding(): boolean {
    return this.glide !== null;
  }

  glideTo(to: View, duration = 1.2): void {
    const from = this.view;
    const arc = geoDistance(from.center, to.center); // radians
    this.glide = {
      from,
      to,
      t: 0,
      duration,
      path: geoInterpolate(from.center, to.center),
      pull: Math.min(0.35, arc / Math.PI), // up to 35% pull-back on a half-world flight
    };
  }

  /** Cancel any glide (the user grabbed the globe). */
  stop(): void {
    this.glide = null;
  }

  /** Advance; returns true if the view changed. */
  update(dt: number): boolean {
    const g = this.glide;
    if (g === null) return false;
    g.t = Math.min(1, g.t + dt / g.duration);
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
    return true;
  }

  /** Rotate by a drag, in degrees; latitude clamped so the globe never flips. */
  pan(dLon: number, dLat: number): void {
    const [lon, lat] = this.view.center;
    // Spread keeps zoom and offset; ±89.9 lets Antarctica be viewed from the pole.
    this.view = { ...this.view, center: [lon + dLon, Math.max(-89.9, Math.min(89.9, lat + dLat))] };
  }
}
