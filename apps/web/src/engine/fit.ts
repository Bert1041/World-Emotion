import type { Continent } from "@world-emotion/shared";
import { geoDistance, geoOrthographic } from "d3-geo";
import { CONTINENT_VIEWS, type View } from "./camera";
import { CLIP_ANGLE } from "./geo";
import { fitGlobe, fitRegion, freeArea, type Rect } from "./layout";

/**
 * Where the globe goes: text never sits on the Earth (README §8.5, e2e/layout.spec.ts). Measures
 * the UI boxes (on resize and card changes, never per frame), fits the world or a continent into the
 * free area, and eases the projection centre toward the new place so layout changes glide too.
 */

export interface FitBoxes {
  readonly header: HTMLElement;
  readonly back: HTMLElement;
  readonly panel: HTMLElement;
  readonly dev: HTMLElement;
  readonly checkin: HTMLElement;
}

/** Box of a fixed-position element, ignoring transforms (offset* is unaffected by them). */
export const boxOf = (el: HTMLElement): Rect => ({
  x: el.offsetLeft,
  y: el.offsetTop,
  w: el.offsetWidth,
  h: el.offsetHeight,
});

/** Points along and inside a continent's lon/lat box, kept only if on the near hemisphere. */
export function framePoints(c: Continent): [number, number][] {
  return framePointsOf(CONTINENT_VIEWS[c]);
}

/** Same, for any view: a 13×13 grid over the box, minus points that face away from `center`. */
export function framePointsOf(view: (typeof CONTINENT_VIEWS)[Continent]): [number, number][] {
  const { center, box } = view;
  const [[w, s], [e, n]] = box;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++) {
      const p: [number, number] = [w + ((e - w) * i) / 12, s + ((n - s) * j) / 12];
      if (geoDistance(center, p) < Math.PI / 2 - 0.01) pts.push(p);
    }
  return pts;
}

/** The view that fits continent `c` into `free` (canvas px) at the given base radius. */
export function fitFrameIn(c: Continent, baseRadius: number, free: Rect): View {
  const { center } = CONTINENT_VIEWS[c];
  const probe = geoOrthographic()
    .clipAngle(CLIP_ANGLE)
    .rotate([-center[0], -center[1]])
    .scale(baseRadius)
    .translate([0, 0]);
  const projected = framePoints(c)
    .map((p) => probe(p))
    .filter((p): p is [number, number] => p !== null);
  // Zoom may go below 1: a big continent on a small free area must still fit entirely.
  const fit = fitRegion(projected, { x: 0, y: 0, w: free.w, h: free.h }, baseRadius, {
    min: 0.4,
    max: 6,
  });
  return { center, zoom: fit.zoom, offset: fit.offset };
}

export class LayoutFit {
  /** Projection centre (canvas px), eased toward `goal`. */
  readonly anchor = { x: 0, y: 0 };
  goal = { x: 0, y: 0 };
  /** Globe radius at zoom 1 (canvas px): the largest globe whose halo fits the world free area. */
  baseRadius = 1;
  /** Free area beside/above the card while zoomed (CSS px), or null in the world view. */
  regionFree: Rect | null = null;
  /** Visible height of the card at the last measurement (CSS px). */
  cardH = 0;
  /** Topmost bottom bar last seen in world view; kept while zoomed so the world fit stays put. */
  private lastBottom: Rect | null = null;
  /** The check-in panel docked to the right (phone on its side), kept while zoomed likewise. */
  private lastRight: Rect | null = null;

  constructor(
    private readonly els: FitBoxes,
    private readonly docked: MediaQueryList,
    private readonly side: MediaQueryList,
  ) {}

  measure(focus: Continent | null, dpr: number): void {
    const { els } = this;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const docked = this.docked.matches;
    const bars = [docked ? null : els.checkin, els.dev]
      .filter((el): el is HTMLElement => el !== null && !el.hidden)
      .map(boxOf);
    if (bars.length > 0) this.lastBottom = bars.reduce((a, b) => (a.y < b.y ? a : b));
    else if (focus === null) this.lastBottom = null; // world view with nothing at the bottom
    if (docked && !els.checkin.hidden) this.lastRight = boxOf(els.checkin);
    else if (!docked) this.lastRight = null;
    const world = fitGlobe(
      freeArea({
        viewport,
        top: boxOf(els.header),
        bottom: this.lastBottom,
        right: this.lastRight,
      }),
    );
    this.baseRadius = world.r * dpr;
    if (focus === null || els.panel.hidden) {
      this.regionFree = null;
      this.goal = { x: world.cx * dpr, y: world.cy * dpr };
      return;
    }
    // A peek card is pushed down by a translate (offset* ignores it): measure its visible part.
    const box = boxOf(els.panel);
    const pushed = Math.min(box.h, Number(els.panel.dataset.peekOffset) || 0);
    const card = { x: box.x, y: box.y + pushed, w: box.w, h: box.h - pushed };
    this.cardH = card.h;
    this.regionFree = freeArea({
      viewport,
      top: els.back.hidden ? null : boxOf(els.back),
      card,
      cardSide: this.side.matches ? "left" : "bottom",
    });
    this.goal = {
      x: (this.regionFree.x + this.regionFree.w / 2) * dpr,
      y: (this.regionFree.y + this.regionFree.h / 2) * dpr,
    };
  }

  /** Jump the anchor to the goal (resize: no glide). */
  snap(): void {
    this.anchor.x = this.goal.x;
    this.anchor.y = this.goal.y;
  }

  /** Ease the anchor toward the goal; true while still moving. */
  ease(dt: number): boolean {
    const k = 1 - Math.exp(-dt * 7);
    const dx = (this.goal.x - this.anchor.x) * k;
    const dy = (this.goal.y - this.anchor.y) * k;
    this.anchor.x += dx;
    this.anchor.y += dy;
    return Math.abs(dx) + Math.abs(dy) > 0.3;
  }

  /** The view that fits continent `c` into the free area beside/above the card. */
  fitFrame(c: Continent, dpr: number): View {
    const free = this.regionFree ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    return fitFrameIn(c, this.baseRadius, { x: 0, y: 0, w: free.w * dpr, h: free.h * dpr });
  }
}
