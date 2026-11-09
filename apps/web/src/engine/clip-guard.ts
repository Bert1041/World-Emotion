/**
 * Guard against d3's horizon clipping turning a polygon inside out (found 2026-11-09). For about 1
 * in 10,000 polygons that cross the horizon, d3-geo's clip emits the whole globe disk with the
 * shape as a hole, so one country's colour floods the globe for a frame while it spins. Changing
 * the clip angle (89.999°, 89.9°) or resampling only moved which views fail (measured 2026-11-09).
 *
 * The test is geometric: a polygon whose points all lie within angle ρ of a centre projects
 * (orthographic is a contraction) inside a disk of radius 2r·sin(ρ/2), so its drawn area can never
 * exceed that disk. An inverted result covers nearly the whole globe and breaks the bound. Only
 * polygons that cross the horizon need the check: anything fully in front is never clipped.
 */

import { type GeoPath, geoDistance } from "d3-geo";
import type { Part } from "./geo";

const HALF_PI = Math.PI / 2;

/** Largest area (px²) a polygon within angle `rho` (radians) of a centre can cover when drawn. */
export function areaBound(rho: number, r: number): number {
  const reach = 2 * r * Math.sin(Math.min(rho, Math.PI) / 2);
  return Math.min(Math.PI * r * r, Math.PI * reach * reach);
}

/**
 * A minimal path context for d3's geoPath: records one shape's projected rings, sums their area
 * (shoelace, per ring), and can replay them onto a real canvas context.
 */
export class ShapeRecorder {
  private xs: number[] = [];
  private ys: number[] = [];
  /** Index where each ring starts. */
  private starts: number[] = [];
  private signed = 0;
  private ringStart = -1;

  reset(): void {
    this.xs.length = 0;
    this.ys.length = 0;
    this.starts.length = 0;
    this.signed = 0;
    this.ringStart = -1;
  }

  moveTo(x: number, y: number): void {
    this.closeRing();
    this.ringStart = this.xs.length;
    this.starts.push(this.ringStart);
    this.xs.push(x);
    this.ys.push(y);
  }

  lineTo(x: number, y: number): void {
    const n = this.xs.length;
    if (n > 0) this.signed += (this.xs[n - 1] as number) * y - x * (this.ys[n - 1] as number);
    this.xs.push(x);
    this.ys.push(y);
  }

  closePath(): void {
    this.closeRing();
  }

  /** geoPath draws points as arcs; polygons never use it. */
  arc(): void {}

  /** Absolute area of everything recorded, px² (rings' signed areas summed: holes subtract). */
  area(): number {
    this.closeRing();
    return Math.abs(this.signed) / 2;
  }

  replay(ctx: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "closePath">): void {
    this.closeRing();
    const { xs, ys, starts } = this;
    for (let k = 0; k < starts.length; k++) {
      const a = starts[k] as number;
      const b = k + 1 < starts.length ? (starts[k + 1] as number) : xs.length;
      ctx.moveTo(xs[a] as number, ys[a] as number);
      for (let i = a + 1; i < b; i++) ctx.lineTo(xs[i] as number, ys[i] as number);
      ctx.closePath();
    }
  }

  /** Add the closing edge of the open ring to the area (once). */
  private closeRing(): void {
    if (this.ringStart < 0) return;
    const n = this.xs.length;
    const a = this.ringStart;
    this.signed +=
      (this.xs[n - 1] as number) * (this.ys[a] as number) -
      (this.xs[a] as number) * (this.ys[n - 1] as number);
    this.ringStart = -1;
  }
}

/**
 * Add one shape's polygons to the current path (`path` draws to the canvas; `guardPath` draws to
 * `recorder`; `sink` receives replays). Fully in front: drawn directly. Crossing the horizon:
 * traced, and dropped for this frame if inside out. Behind: skipped when culling, else left to
 * d3. Returns how many polygons were dropped.
 */
export function addGuarded(
  parts: readonly Part[],
  viewCenter: [number, number],
  r: number,
  cull: boolean,
  path: GeoPath,
  guardPath: GeoPath,
  recorder: ShapeRecorder,
  sink: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "closePath">,
): number {
  let dropped = 0;
  for (const { polygon, cap } of parts) {
    const d = geoDistance(cap.center, viewCenter);
    if (d - cap.radius >= HALF_PI) {
      if (!cull) path(polygon);
      continue;
    }
    if (d + cap.radius < HALF_PI) {
      path(polygon);
      continue;
    }
    recorder.reset();
    guardPath(polygon);
    if (recorder.area() <= areaBound(cap.radius, r) * 1.001 + 1) recorder.replay(sink);
    else dropped++;
  }
  return dropped;
}
