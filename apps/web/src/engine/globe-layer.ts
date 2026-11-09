import { type GeoPath, type GeoProjection, geoDistance, geoPath } from "d3-geo";

import type { Feature } from "geojson";
import { addGuarded, ShapeRecorder } from "./clip-guard";
import type { Lod } from "./geo";
import { NIGHT_GRID, shadeNight, sunInView } from "./night";
import { BORDER, NEUTRAL_LAND, OCEAN, PAPER, SPHERE_EDGE } from "./palette";

export interface DrawOptions {
  /** Skip features entirely on the far hemisphere. */
  readonly cull: boolean;
  /** Draw the internal border mesh (a second pass over most arcs). */
  readonly borders: boolean;
  /** [lon, lat] at the centre of the view, degrees. */
  readonly viewCenter: [number, number];
  /** Sub-solar point [lon, lat] for the night shade (engine/night.ts); omitted = no night. */
  readonly night?: readonly [number, number];
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
  /** Horizon-crossing polygons are traced here first and checked (engine/clip-guard.ts). */
  private readonly recorder = new ShapeRecorder();
  private readonly guardPath: GeoPath;
  /** Polygons skipped because d3 clipped them inside out (diagnostics; one frame each). */
  inverted = 0;
  private groups: { color: string; features: Feature[] }[] = [];
  private groupedFor: { lod: Lod; version: number } | undefined;
  /** Night shade texture (NIGHT_GRID²), recomputed each base redraw; created on first use. */
  private nightTex: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    img: ImageData;
  } | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    projection: GeoProjection,
  ) {
    this.projection = projection;
    this.path = geoPath(projection, ctx);
    this.guardPath = geoPath(projection, this.recorder as unknown as CanvasRenderingContext2D);
  }

  /**
   * Add a shape to the current path, polygon by polygon: those fully in front are drawn as they
   * are; those crossing the horizon are traced, and dropped for this frame if d3's clipping turned
   * them inside out (their area breaks the bound for their cap). Behind the globe: skipped when
   * culling, else left to d3 (it clips them to nothing).
   */
  private addShape(lod: Lod, f: Feature, viewCenter: [number, number], cull: boolean): void {
    const parts = lod.parts.get(f);
    if (parts === undefined) this.path(f);
    else
      this.inverted += addGuarded(
        parts,
        viewCenter,
        this.projection.scale(),
        cull,
        this.path,
        this.guardPath,
        this.recorder,
        this.ctx,
      );
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
      for (const f of lod.shapes.countries) {
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
      for (const f of g.features) if (visible(f)) this.addShape(lod, f, opts.viewCenter, opts.cull);
      ctx.fillStyle = g.color;
      ctx.fill();
    }
    ctx.beginPath();
    for (const f of lod.shapes.neutral)
      if (visible(f)) this.addShape(lod, f, opts.viewCenter, opts.cull);
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

    if (opts.night) this.drawNight(opts.night, cx, cy, r);

    if (selected !== null) {
      const f = lod.shapes.countries.find((x) => x.id === selected);
      if (f) {
        ctx.beginPath();
        this.addShape(lod, f, opts.viewCenter, opts.cull);
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

  /** The night shade: a small per-texel texture, scaled up smoothly and clipped to the globe. */
  private drawNight(sun: readonly [number, number], cx: number, cy: number, r: number): void {
    if (this.nightTex === null) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = NIGHT_GRID;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      this.nightTex = { canvas, ctx, img: ctx.createImageData(NIGHT_GRID, NIGHT_GRID) };
    }
    const tex = this.nightTex;
    const box = shadeNight(tex.img.data, NIGHT_GRID, sunInView(sun, this.projection.rotate()));
    if (box === null) return; // all day in view
    tex.ctx.putImageData(tex.img, 0, 0);
    // Only the shaded texels, plus one each side so smoothing at the box edge samples true zeros.
    const i0 = Math.max(0, box[0] - 1);
    const j0 = Math.max(0, box[1] - 1);
    const i1 = Math.min(NIGHT_GRID - 1, box[2] + 1);
    const j1 = Math.min(NIGHT_GRID - 1, box[3] + 1);
    const texel = (2 * r) / NIGHT_GRID;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.clip();
    // Bilinear ("low") is exact enough for a smooth gradient; "high" cost 2× in software raster.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    ctx.drawImage(
      tex.canvas,
      i0,
      j0,
      w,
      h,
      cx - r + i0 * texel,
      cy - r + j0 * texel,
      w * texel,
      h * texel,
    );
    ctx.restore();
  }
}
