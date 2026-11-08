/**
 * Screen layout rules (docs/design/phase-3b-look-and-feel.md): **text never sits on the Earth.**
 * Pure functions, unit-tested; the browser layout test (e2e/layout.spec.ts) checks the result at
 * real viewport sizes.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const GAP = 16;
/** The atmosphere glow extends past the sphere; keep it clear of text too. */
export const HALO = 1.12;

export interface Obstacles {
  readonly viewport: { readonly w: number; readonly h: number };
  /** Text at the top (world headline), or the back button when zoomed. */
  readonly top?: Rect | null;
  /** Anything along the bottom (check-in bar, prototype mood bar). */
  readonly bottom?: Rect | null;
  /** Anything docked to the right edge (the check-in bar on short landscape screens). */
  readonly right?: Rect | null;
  /** The region card: at the side on wide screens, at the bottom on narrow ones. */
  readonly card?: Rect | null;
  readonly cardSide?: "left" | "bottom";
}

/** The largest rectangle left for the globe once every piece of UI (plus a gap) is excluded. */
export function freeArea(o: Obstacles): Rect {
  let x0 = GAP;
  let y0 = GAP;
  let x1 = o.viewport.w - GAP;
  let y1 = o.viewport.h - GAP;
  if (o.top) y0 = Math.max(y0, o.top.y + o.top.h + GAP);
  if (o.bottom) y1 = Math.min(y1, o.bottom.y - GAP);
  if (o.right) x1 = Math.min(x1, o.right.x - GAP);
  if (o.card && o.cardSide === "left") x0 = Math.max(x0, o.card.x + o.card.w + GAP);
  if (o.card && o.cardSide === "bottom") y1 = Math.min(y1, o.card.y - GAP);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** World view: the globe (with its halo) fills the free area and is centred in it. */
export function fitGlobe(free: Rect): { cx: number; cy: number; r: number } {
  return {
    cx: free.x + free.w / 2,
    cy: free.y + free.h / 2,
    r: Math.max(0, Math.min(free.w, free.h) / 2 / HALO),
  };
}

/**
 * Zoom and offset that fit a set of projected points (computed at zoom 1, centred on 0,0, in the
 * same units as `baseRadius`) into `free`. `offset` is the points' centre in base-radius units,
 * so translate = freeCentre − offset × scale puts the region in the middle of the free area.
 */
export function fitRegion(
  points: readonly (readonly [number, number])[],
  free: Rect,
  baseRadius: number,
  limits: { min: number; max: number } = { min: 1, max: 6 },
): { zoom: number; offset: [number, number] } {
  if (points.length === 0 || baseRadius <= 0) return { zoom: 1, offset: [0, 0] };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bw = Math.max(maxX - minX, 1e-6);
  const bh = Math.max(maxY - minY, 1e-6);
  const zoom = Math.min(limits.max, Math.max(limits.min, Math.min(free.w / bw, free.h / bh)));
  return { zoom, offset: [(minX + maxX) / 2 / baseRadius, (minY + maxY) / 2 / baseRadius] };
}

/** Do a circle and a rectangle overlap? (Used by tests and by the dev overlay.) */
export function circleHitsRect(c: { cx: number; cy: number; r: number }, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(c.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.cy, r.y + r.h));
  return (c.cx - nx) ** 2 + (c.cy - ny) ** 2 < c.r ** 2;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
