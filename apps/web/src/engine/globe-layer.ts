import { type GeoPath, type GeoProjection, geoDistance, geoPath } from "d3-geo";
import type { Feature } from "geojson";
import type { Lod } from "./geo";
import { BORDER, NEUTRAL_LAND, OCEAN, PAPER, SPHERE_EDGE } from "./palette";

export interface DrawOptions {
  /** Skip features entirely on the far hemisphere. */
  readonly cull: boolean;
  /** Draw the internal border mesh (a second pass over most arcs). */
  readonly borders: boolean;
  /** [lon, lat] at the centre of the view, degrees. */
  readonly viewCenter: [number, number];
}

export interface GlobeStyle {
  readonly skyInner: string;
  readonly skyOuter: string;
  readonly ocean: string;
  readonly neutral: string;
  readonly border: string;
  readonly edge: string;
}

/** Fixed style for the benchmark and the pixel-exact verification (comparable across runs). */
export const REFERENCE_STYLE: GlobeStyle = {
  skyInner: PAPER,
  skyOuter: PAPER,
  ocean: OCEAN,
  neutral: NEUTRAL_LAND,
  border: BORDER,
  edge: SPHERE_EDGE,
};

/**
 * Layer 2 (README §8.1): sky, ocean, land, fills, borders. Countries are grouped by fill colour so
 * a frame issues one fill per colour, not one per country. Groups are rebuilt only when the
 * colouring (`colorVersion`) or the level of detail changes, never per frame.
 */
export class GlobeLayer {
  private readonly path: GeoPath;
  private readonly projection: GeoProjection;
  private groups: { color: string; features: Feature[] }[] = [];
  private groupedFor: { lod: Lod; version: number } | undefined;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    projection: GeoProjection,
  ) {
    this.projection = projection;
    this.path = geoPath(projection, ctx);
  }

  draw(
    lod: Lod,
    colorOf: (code: string) => string,
    colorVersion: number,
    selected: string | null,
    opts: DrawOptions,
    style: GlobeStyle = REFERENCE_STYLE,
  ): void {
    const { ctx, path } = this;
    const { width, height } = ctx.canvas;
    const visible = (f: Feature) => {
      if (!opts.cull) return true;
      const cap = lod.caps.get(f);
      return (
        cap === undefined || geoDistance(cap.center, opts.viewCenter) - cap.radius < Math.PI / 2
      );
    };

    // Sky. The canvas is opaque (alpha: false), so it must be painted, never cleared.
    const [cx, cy] = this.projection.translate();
    const r = this.projection.scale();
    if (style.skyInner === style.skyOuter) ctx.fillStyle = style.skyInner;
    else {
      const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, Math.hypot(width, height) * 0.6);
      g.addColorStop(0, style.skyInner);
      g.addColorStop(1, style.skyOuter);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, width, height);

    if (this.groupedFor?.lod !== lod || this.groupedFor.version !== colorVersion) {
      const byColor = new Map<string, Feature[]>();
      for (const f of lod.countries) {
        const c = colorOf(String(f.id));
        const list = byColor.get(c);
        if (list) list.push(f);
        else byColor.set(c, [f]);
      }
      this.groups = [...byColor].map(([color, features]) => ({ color, features }));
      this.groupedFor = { lod, version: colorVersion };
    }

    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = style.ocean;
    ctx.fill();

    for (const g of this.groups) {
      ctx.beginPath();
      for (const f of g.features) if (visible(f)) path(f);
      ctx.fillStyle = g.color;
      ctx.fill();
    }
    ctx.beginPath();
    for (const f of lod.neutral) if (visible(f)) path(f);
    ctx.fillStyle = style.neutral;
    ctx.fill();

    const hair = ctx.canvas.width / (ctx.canvas.clientWidth || ctx.canvas.width);
    ctx.lineWidth = 0.6 * hair;
    if (opts.borders) {
      ctx.beginPath();
      path(lod.borders);
      ctx.strokeStyle = style.border;
      ctx.stroke();
    }

    if (selected !== null) {
      const f = lod.countries.find((x) => x.id === selected);
      if (f) {
        ctx.beginPath();
        path(f);
        ctx.lineWidth = 2.2 * hair;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }
    }

    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.lineWidth = 1.5 * hair;
    ctx.strokeStyle = style.edge;
    ctx.stroke();
  }
}
