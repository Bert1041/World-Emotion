import type { Continent } from "@world-emotion/shared";
import type { GeoProjection } from "d3-geo";
import type { Pin } from "../checkin/saved-pin";
import type { Camera } from "../engine/camera";
import { framePoints } from "../engine/fit";
import { HALO, type Rect } from "../engine/layout";
import type { Ripples } from "../engine/ripple";
import type { LayoutReport } from "./probe";

/**
 * `window.__bench`: the always-on hooks the browser tests and tools/bench read (ready, layout,
 * aggregate, face, screenPoint). The ?bench=1 harness adds verifyRender and run on top.
 */
export interface HooksDeps {
  readonly ready: Promise<void>;
  readonly projection: GeoProjection;
  readonly camera: Camera;
  readonly ripples: Ripples;
  dpr(): number;
  focus(): Continent | null;
  /** True between a tap and the start of its glide, so callers never see "arrived". */
  fitPending(): boolean;
  dragging(): boolean;
  particlesDrawn(): boolean;
  easing(): boolean;
  pin(): Pin | null;
  sun(): [number, number] | null;
  worldMood(): string;
  /** The Earth being shown or cross-faded to, by mood name. */
  theme(): string;
  /**
   * Mood weather: whether it has spread over the land, each particle's anchor [lon, lat, mood],
   * and how strongly soft halos are drawn (0 while a finger drags the globe, 1 at rest).
   */
  weather(): { spread: boolean; anchors: [number, number, number][]; halo: number };
  aggregate(): void;
  /** Point the camera at a lon/lat without starting idle rotation. */
  face(lon: number, lat: number): void;
}

export function installTestHooks(d: HooksDeps): void {
  const layout = (): LayoutReport => {
    const { projection, camera } = d;
    const dpr = d.dpr();
    const focus = d.focus();
    const [tx, ty] = projection.translate();
    let focusBox: Rect | null = null;
    if (focus !== null) {
      const pts = framePoints(focus)
        .map((p) => projection(p))
        .filter((p): p is [number, number] => p !== null);
      const xs = pts.map((p) => p[0] / dpr);
      const ys = pts.map((p) => p[1] / dpr);
      focusBox = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    }
    const pin = d.pin();
    return {
      globe: { cx: tx / dpr, cy: ty / dpr, r: projection.scale() / dpr, halo: HALO },
      focus,
      focusBox,
      gliding: camera.gliding || d.fitPending(),
      center: [camera.view.center[0], camera.view.center[1]],
      zoom: camera.rendered.zoom,
      moving: camera.moving || d.dragging(),
      particles: d.particlesDrawn(),
      easing: d.easing(),
      ripple: d.ripples.active,
      pin: pin ? [pin.lonLat[0], pin.lonLat[1]] : null,
      sun: d.sun(),
      worldMood: d.worldMood(),
      theme: d.theme(),
    };
  };
  window.__bench = {
    ready: d.ready,
    layout,
    aggregate: () => d.aggregate(),
    weather: () => d.weather(),
    face: (lon, lat) => d.face(lon, lat),
    screenPoint(lon, lat) {
      const p = d.projection([lon, lat]);
      return p ? [p[0] / d.dpr(), p[1] / d.dpr()] : null;
    },
  };
}
