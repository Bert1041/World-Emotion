import type { Continent } from "@world-emotion/shared";
import type { Rect } from "../engine/layout";

/**
 * The frame loop's two taps for the benchmark harness (loaded only with ?bench=1): `before` may
 * drive the camera deterministically; `after` receives one timing sample per frame. Both are null
 * in normal use, so a frame costs nothing extra.
 */
export interface FrameSample {
  readonly ts: number;
  readonly prevTs: number;
  /** Script time of the whole frame (ms). */
  readonly script: number;
  /** Base-layer draw time (ms), 0 when not redrawn. */
  readonly base: number;
  /** FX-layer time (ms). */
  readonly fx: number;
  readonly drewBase: boolean;
  readonly lod: string;
  readonly rotating: boolean;
}

export interface FrameProbe {
  /** The harness is driving the camera: the frame is "moving" and always dirty. */
  driving: boolean;
  before: ((ts: number) => void) | null;
  after: ((s: FrameSample) => void) | null;
}

/** Real on-screen layout in CSS px, for the browser tests. */
export interface LayoutReport {
  globe: { cx: number; cy: number; r: number; halo: number };
  focus: Continent | null;
  focusBox: Rect | null;
  gliding: boolean;
  worldMood: string;
  /** Resting camera centre [lon, lat], rendered zoom, and whether anything still moves. */
  center: [number, number];
  zoom: number;
  moving: boolean;
  particles: boolean;
  /** The globe is still easing toward a new layout position (fonts, card, rotation). */
  easing: boolean;
  /** A check-in ripple is on the globe. */
  ripple: boolean;
  /** Your pin [lon, lat], or null. */
  pin: [number, number] | null;
  /** Sub-solar point [lon, lat] the night band is drawn for, or null with ?opt=…,nonight. */
  sun: [number, number] | null;
}

/** `window.__bench`: the always-on test hooks, plus the harness's two when ?bench=1. */
export interface TestHooks {
  ready: Promise<void>;
  layout(): LayoutReport;
  /** Run one aggregation now (tests: force a snapshot at a chosen moment). */
  aggregate(): void;
  /** Point the camera at a lon/lat (scripted tours). */
  face(lon: number, lat: number): void;
  /** CSS-pixel position of a lon/lat on screen (null if on the far side), for scripted taps. */
  screenPoint(lon: number, lat: number): [number, number] | null;
  verifyRender?: (variant: VerifyVariant) => Promise<unknown>;
  run?: () => Promise<unknown>;
}

export interface VerifyVariant {
  cull: boolean;
  precision0: boolean;
  /** Self-test: cull against the wrong view centre. Must report large differences. */
  selfTestWrongCenter?: boolean;
}

declare global {
  interface Window {
    __bench?: TestHooks;
  }
}
