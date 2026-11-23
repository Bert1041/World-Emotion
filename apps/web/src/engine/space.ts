/**
 * Space around the Earth (Phase 6.5, V1): a star field in three depths that drifts with the globe's
 * rotation, a faint nebula in the theme's colour and a rare shooting star.
 *
 * Cost: the stars are drawn once into small tiles and shown as repeating CSS backgrounds; each
 * frame only moves the layers with `transform` (compositor), never redraws a canvas.
 */

/** One depth of stars. `drift` is CSS px per degree of rotation: far layers move least. */
export interface StarLayer {
  readonly count: number;
  readonly maxRadius: number;
  readonly brightness: number;
  readonly drift: number;
}

export const STAR_LAYERS: readonly StarLayer[] = [
  { count: 420, maxRadius: 0.7, brightness: 0.6, drift: 0.25 },
  { count: 150, maxRadius: 1.0, brightness: 0.8, drift: 0.6 },
  { count: 40, maxRadius: 1.6, brightness: 1, drift: 1.2 },
];

/** Tile edge, CSS px. Big enough that the repeat is not seen at a glance. */
export const TILE = 512;

/**
 * Where a layer sits for a globe rotation [λ, φ] (degrees, d3's rotate()). Wrapped into one tile
 * (the layer is one tile larger than the screen on every side), so it can drift for ever.
 */
export function parallax(rotate: readonly [number, number], drift: number): [number, number] {
  const wrap = (v: number) => ((v % TILE) + TILE) % TILE;
  return [wrap(rotate[0] * drift) - TILE, wrap(rotate[1] * drift) - TILE];
}

/** Stars for one layer: [x, y, radius, alpha] in tile CSS px; deterministic for a given rng. */
export function scatter(layer: StarLayer, rng: () => number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < layer.count; i++) {
    // Most stars faint and small, a few bright: squaring skews towards the small end.
    const s = rng() ** 2;
    out.push([
      rng() * TILE,
      rng() * TILE,
      0.25 + s * layer.maxRadius,
      layer.brightness * (0.35 + 0.65 * rng()),
    ]);
  }
  return out;
}

/** Offsets at which a star of radius r at v (one axis) is drawn: itself, plus a copy across the
 * tile's edge if it overlaps that edge. */
export function edgeCopies(v: number, r: number): number[] {
  if (v < r) return [0, TILE];
  if (v > TILE - r) return [0, -TILE];
  return [0];
}

/** Draw one layer's tile at the device's pixel ratio; returns an object URL for CSS. */
async function tileUrl(stars: [number, number, number, number][], dpr: number): Promise<string> {
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(TILE * dpr);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  for (const [x, y, r, a] of stars) {
    // A little colour: most stars white, some warm, some blue.
    const hue = (x * 7 + y * 13) % 10;
    const rgb = hue < 2 ? "255,214,170" : hue < 4 ? "190,215,255" : "255,255,255";
    ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
    // Draw each star again on the opposite edge if it overlaps, so the tile repeats seamlessly.
    for (const dx of edgeCopies(x, r))
      for (const dy of edgeCopies(y, r)) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok));
  return blob === null ? "" : URL.createObjectURL(blob);
}

export class Space {
  private readonly layers: HTMLElement[];
  private readonly last: [number, number][] = [];
  private meteorTimer = 0;
  private skyKey = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: { readonly reducedMotion: boolean; readonly rng: () => number },
  ) {
    this.layers = [...root.querySelectorAll<HTMLElement>(".stars")];
  }

  /** Make the tiles (async: toBlob), then show the layers. */
  async build(dpr: number): Promise<void> {
    const urls = await Promise.all(
      STAR_LAYERS.map((l) => tileUrl(scatter(l, this.opts.rng), Math.min(dpr, 2))),
    );
    this.layers.forEach((el, i) => {
      el.style.backgroundImage = `url(${urls[i]})`;
    });
    this.root.dataset.ready = "1";
    if (!this.opts.reducedMotion) this.scheduleMeteor();
  }

  /** Move the layers with the globe; skipped when nothing moved by a quarter pixel. */
  follow(rotate: readonly [number, number]): void {
    if (this.opts.reducedMotion) return;
    STAR_LAYERS.forEach((l, i) => {
      const [x, y] = parallax(rotate, l.drift);
      const prev = this.last[i];
      if (prev && Math.abs(prev[0] - x) < 0.25 && Math.abs(prev[1] - y) < 0.25) return;
      this.last[i] = [x, y];
      const el = this.layers[i];
      if (el) el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    });
  }

  /**
   * The sky's colours, from the theme (the base canvas no longer paints them), centred on the
   * globe. Only touches the page when something changed: a new value repaints the full-screen
   * gradient, so this must not happen on every frame.
   */
  sky(inner: string, outer: string, cx: number, cy: number): void {
    const key = `${inner}|${outer}|${Math.round(cx / 2)}|${Math.round(cy / 2)}`;
    if (key === this.skyKey) return;
    this.skyKey = key;
    const s = this.root.style;
    s.setProperty("--sky-inner", inner);
    s.setProperty("--sky-outer", outer);
    s.setProperty("--gx", `${cx.toFixed(0)}px`);
    s.setProperty("--gy", `${cy.toFixed(0)}px`);
  }

  /** A shooting star every 25–70 s, somewhere in the upper part of the screen. */
  private scheduleMeteor(): void {
    clearTimeout(this.meteorTimer);
    this.meteorTimer = window.setTimeout(
      () => {
        const m = this.root.querySelector<HTMLElement>(".meteor");
        if (m && !document.hidden) {
          m.style.left = `${(10 + this.opts.rng() * 70).toFixed(1)}%`;
          m.style.top = `${(5 + this.opts.rng() * 35).toFixed(1)}%`;
          m.classList.remove("go");
          void m.offsetWidth; // restart the animation
          m.classList.add("go");
        }
        this.scheduleMeteor();
      },
      25_000 + this.opts.rng() * 45_000,
    );
  }
}
