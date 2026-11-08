import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import { FixedStep, hexToOklab, mixOklab, oklabToCss, SPRING, Spring } from "@world-emotion/motion";
import {
  type Continent,
  MOOD_COUNT,
  MOODS,
  type MoodId,
  type Snapshot,
  type SnapshotRegion,
} from "@world-emotion/shared";
import { geoCentroid, geoCircle, geoContains, geoDistance, geoOrthographic, geoPath } from "d3-geo";
import { flushSync, mount } from "svelte";
import { SnapshotSim } from "./demo/snapshot-sim";
import {
  Camera,
  CONTINENT_NAMES,
  CONTINENT_VIEWS,
  STRETCH_COMMIT,
  type View,
} from "./engine/camera";
import { guessCountry } from "./engine/country-guess";
import { type Lod, type LodName, loadLod, loadMoveLod, pointCount } from "./engine/geo";
import { GlobeLayer } from "./engine/globe-layer";
import { fitGlobe, fitRegion, freeArea, HALO, type Rect } from "./engine/layout";
import { MOOD_COLORS } from "./engine/palette";
import { ParticleField, rng, type SpawnPoint } from "./engine/particles";
import { pinPoint } from "./engine/pin";
import { Ripples } from "./engine/ripple";
import { FrameRecorder, type FrameSummary } from "./engine/stats";
import { ThemeMixer } from "./engine/themes";
import App from "./ui/App.svelte";
import { type Bar, view } from "./ui/view.svelte";

// ---- Configuration (URL params; the bench runner sweeps scenarios with bench=1) -------------
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => {
  const v = Number(params.get(k));
  return Number.isFinite(v) && params.has(k) ? v : d;
};
const config = {
  bench: params.get("bench") === "1",
  particles: num("particles", 700),
  /** Map drawn on animation frames; "move" unless a bench scenario compares another. */
  dragLod: (["110m", "50m"].includes(params.get("dragLod") ?? "")
    ? params.get("dragLod")
    : "move") as LodName,
  /** Share of the 110m points the moving map keeps (tuned on the Pixel, docs/bench). */
  moveKeep: num("moveKeep", 0.25),
  dprCap: num("dpr", 2),
  benchSeconds: num("seconds", 10),
  expectedHz: num("hz", 60),
  /** Render optimisations (pixel-identical on 110m/50m; ≤0.06% of pixels on the moving map, see
   * verifyRender): on unless switched off. */
  opt: new Set((params.get("opt") ?? "precision0,cull").split(",").filter(Boolean)),
  debug: params.get("debug") === "1",
  /** Prototype theme switcher (bottom bar); off by default now the check-in owns the bottom. */
  dev: params.get("dev") === "1",
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- DOM --------------------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const baseCanvas = $<HTMLCanvasElement>("base");
const fxCanvas = $<HTMLCanvasElement>("fx");
const perf = $("perf");
const baseCtx = baseCanvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
const fxCtx = fxCanvas.getContext("2d") as CanvasRenderingContext2D;
// UI (Svelte) renders `view`; the engine writes to it. Called back on clicks only, after init.
/**
 * Layout callbacks from the UI are ignored until start() has measured once: a component may
 * report during mount (under reduced motion the card settles synchronously), before the
 * engine's element references and canvases exist.
 */
let layoutReady = false;
mount(App, {
  target: $("ui"),
  props: {
    actions: {
      back: () => leave(),
      previewMood: (m: MoodId) => {
        sim.bias = m;
        autoCycle = false;
        view.autoCycle = false;
      },
      checkIn: (mood: MoodId, from: { x: number; y: number }) => checkIn(mood, from),
      setCountry: (code: string) => setCountry(code),
      startPick: () => startPick(),
      cancelPick: () => {
        view.checkin.picking = false;
      },
      landed: (id: number) => landed(id),
      cardMoved: () => {
        if (layoutReady) refitToCard();
      },
      toggleAuto: () => {
        autoCycle = !autoCycle;
        cycleAt = performance.now();
        view.autoCycle = autoCycle;
      },
    },
  },
});
flushSync();
/** Boxes the layout measures (ids kept stable for index.html CSS and e2e/layout.spec.ts). */
const ui = {
  back: $<HTMLButtonElement>("back"),
  panel: $("panel"),
  dev: $("dev"),
  checkin: $("checkin"),
  overlays: { scanlines: $("scanlines"), frost: $("frost"), heat: $("heat") },
};
const countryName = new Intl.DisplayNames([navigator.language, "en"], { type: "region" });

// ---- Globe ------------------------------------------------------------------------------------
const projection = geoOrthographic().clipAngle(90);
if (config.opt.has("precision0")) projection.precision(0);
const globe = new GlobeLayer(baseCtx, projection);
const camera = new Camera({ center: [10, 20], zoom: 1 }, { reducedMotion });
let dpr = 1;
/** Globe radius at zoom 1 (canvas px): the largest globe whose halo fits the world free area. */
let baseRadius = 1;

// ---- Layout: text never sits on the Earth (engine/layout.ts, e2e/layout.spec.ts) --------------
const header = document.querySelector("header") as HTMLElement;
/** Projection centre (canvas px), eased toward `anchorGoal` so layout changes glide too. */
const anchor = { x: 0, y: 0 };
let anchorGoal = { x: 0, y: 0 };
let regionFree: Rect | null = null;
/** Topmost bottom bar (check-in, dev) last seen in world view; kept while zoomed so the world
 * fit does not change when the bars hide. */
let lastBottom: Rect | null = null;
/** The check-in panel docked to the right (phone on its side), kept while zoomed likewise. */
let lastRight: Rect | null = null;
let lastCardH = 0;

/** A phone on its side docks the check-in panel to the right. Must match index.html. */
const DOCK_RIGHT = matchMedia("(min-aspect-ratio: 6/5) and (max-height: 520px)");
/** Landscape-shaped screens get a side card; portrait ones a bottom sheet. Must match index.html. */
const SIDE_CARD = matchMedia("(min-aspect-ratio: 6/5)");

/** Box of a fixed-position element, ignoring transforms (offset* is unaffected by them). */
const boxOf = (el: HTMLElement): Rect => ({
  x: el.offsetLeft,
  y: el.offsetTop,
  w: el.offsetWidth,
  h: el.offsetHeight,
});

/** Measured on resize and when the card changes, never per frame (no forced layout per frame). */
function measureLayout(): void {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const docked = DOCK_RIGHT.matches;
  const bars = [docked ? null : ui.checkin, ui.dev]
    .filter((el): el is HTMLElement => el !== null && !el.hidden)
    .map(boxOf);
  if (bars.length > 0) lastBottom = bars.reduce((a, b) => (a.y < b.y ? a : b));
  else if (focus === null) lastBottom = null; // world view with nothing at the bottom (docked)
  if (docked && !ui.checkin.hidden) lastRight = boxOf(ui.checkin);
  else if (!docked) lastRight = null;
  const world = fitGlobe(
    freeArea({ viewport, top: boxOf(header), bottom: lastBottom, right: lastRight }),
  );
  baseRadius = world.r * dpr;
  if (focus === null || ui.panel.hidden) {
    regionFree = null;
    anchorGoal = { x: world.cx * dpr, y: world.cy * dpr };
    return;
  }
  const wide = SIDE_CARD.matches;
  // A peek card is pushed down by a translate (offset* ignores it): measure its visible part.
  const box = boxOf(ui.panel);
  const pushed = Math.min(box.h, Number(ui.panel.dataset.peekOffset) || 0);
  const card = { x: box.x, y: box.y + pushed, w: box.w, h: box.h - pushed };
  lastCardH = card.h;
  regionFree = freeArea({
    viewport,
    top: ui.back.hidden ? null : boxOf(ui.back),
    card,
    cardSide: wide ? "left" : "bottom",
  });
  anchorGoal = {
    x: (regionFree.x + regionFree.w / 2) * dpr,
    y: (regionFree.y + regionFree.h / 2) * dpr,
  };
}

function easeAnchor(dt: number): boolean {
  const k = 1 - Math.exp(-dt * 7);
  const dx = (anchorGoal.x - anchor.x) * k;
  const dy = (anchorGoal.y - anchor.y) * k;
  anchor.x += dx;
  anchor.y += dy;
  return Math.abs(dx) + Math.abs(dy) > 0.3;
}

/** Points along and inside a continent's lon/lat box, kept only if on the near hemisphere. */
function framePoints(c: Continent): [number, number][] {
  const { center, box } = CONTINENT_VIEWS[c];
  const [[w, s], [e, n]] = box;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 12; j++) {
      const p: [number, number] = [w + ((e - w) * i) / 12, s + ((n - s) * j) / 12];
      if (geoDistance(center, p) < Math.PI / 2 - 0.01) pts.push(p);
    }
  return pts;
}

/** The view that fits continent `c` into the free area beside/above the card. */
function fitFrame(c: Continent): View {
  const { center } = CONTINENT_VIEWS[c];
  const probe = geoOrthographic()
    .clipAngle(90)
    .rotate([-center[0], -center[1]])
    .scale(baseRadius)
    .translate([0, 0]);
  const projected = framePoints(c)
    .map((p) => probe(p))
    .filter((p): p is [number, number] => p !== null);
  const free = regionFree ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  // Zoom may go below 1: a big continent on a small free area must still fit entirely.
  const fit = fitRegion(projected, { x: 0, y: 0, w: free.w * dpr, h: free.h * dpr }, baseRadius, {
    min: 0.4,
    max: 6,
  });
  return { center, zoom: fit.zoom, offset: fit.offset };
}

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, config.dprCap);
  for (const c of [baseCanvas, fxCanvas]) {
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }
  measureLayout();
  anchor.x = anchorGoal.x;
  anchor.y = anchorGoal.y;
  if (focus !== null) {
    camera.stop();
    camera.view = fitFrame(focus);
  }
  dirty = true;
}

function applyCamera(): void {
  const v = camera.rendered; // includes a zoom gesture's rubber-band stretch
  const [lon, lat] = v.center;
  const scale = baseRadius * v.zoom;
  const [ox, oy] = v.offset ?? [0, 0];
  projection
    .rotate([-lon, -lat])
    .scale(scale)
    .translate([anchor.x - ox * scale, anchor.y - oy * scale]);
}

// ---- Data → colours and weather ---------------------------------------------------------------
const sim = new SnapshotSim(1);
let snapshot: Snapshot = sim.snapshot;
const mixer = new ThemeMixer(snapshot.world.h, 2.5);
const moodLab = MOOD_COLORS.map(hexToOklab);
const fills = new Map<string, string>();
let colorVersion = 0;
let focus: Continent | null = null;
let selected: string | null = null;

/** How clearly a region leads with its headline: 0 (dead heat) … 1 (clear). */
function clarity(r: SnapshotRegion): number {
  const sorted = [...r.dist].sort((a, b) => b - a);
  return Math.min(1, ((sorted[0] ?? 0) - (sorted[1] ?? 0)) / 0.25);
}

/** A country's region, falling back to its continent when below the privacy floor. */
function regionOf(code: string): { region: SnapshotRegion; quiet: boolean } | null {
  const own = snapshot.countries[code];
  if (own) return { region: own, quiet: false };
  const c = COUNTRY_TO_CONTINENT.get(code);
  const parent = c ? snapshot.continents[c] : undefined;
  return parent ? { region: parent, quiet: true } : null;
}

function recomputeFills(): void {
  const t = mixer.current;
  fills.clear();
  for (const code of COUNTRY_TO_CONTINENT.keys()) {
    const r = regionOf(code);
    // Quantised strength keeps the number of distinct fills (= fill calls) small.
    const strength = r ? Math.round(clarity(r.region) * (r.quiet ? 0.4 : 1) * 3) / 3 : 0;
    let col = r
      ? mixOklab(t.lab.land, moodLab[r.region.h] ?? t.lab.land, 0.12 + 0.7 * strength)
      : t.lab.land;
    if (focus !== null && COUNTRY_TO_CONTINENT.get(code) !== focus)
      col = mixOklab(col, t.lab.ocean, 0.7);
    fills.set(code, oklabToCss(col));
  }
  colorVersion++;
  dirty = true;
}

let centroids: { code: string; lon: number; lat: number }[] = [];
function recomputeWeather(): void {
  const spawns: SpawnPoint[] = [];
  for (const { code, lon, lat } of centroids) {
    const r = regionOf(code);
    if (!r) continue;
    if (focus !== null && COUNTRY_TO_CONTINENT.get(code) !== focus) continue;
    // Quiet regions are faint (README §8.2.3): weight by clarity and sample size.
    const weight = (0.05 + clarity(r.region)) * (r.quiet ? 0.3 : 1) * Math.log10(10 + r.region.n);
    spawns.push({ lon, lat, mood: r.region.h, weight });
  }
  particles.setSpawns(spawns);
}

function onSnapshot(next: Snapshot): void {
  snapshot = next;
  if (next.world.h !== mixer.target) {
    mixer.setTarget(next.world.h);
    view.worldSwap++; // replay the word's entrance
  }
  view.worldMood = MOODS[next.world.h] ?? "";
  // Held still while your face is in flight: the landing ticks it (see landed()).
  if (view.flight === null) view.worldCount = next.world.n;
  recomputeFills();
  recomputeWeather();
  renderPanel();
}

// ---- Panels -----------------------------------------------------------------------------------
function barsOf(r: SnapshotRegion): Bar[] {
  return MOODS.map((name, m) => ({
    name,
    share: r.dist[m] ?? 0,
    pct: Math.round((r.dist[m] ?? 0) * 100),
    color: MOOD_COLORS[m] ?? "#fff",
    lead: m === r.h,
  }));
}

/** "feels <mood>": the mood is always named, never colour alone. */
const moodOf = (m: MoodId | null) =>
  m === null ? null : { id: m, name: MOODS[m] ?? "", color: MOOD_COLORS[m] ?? "" };

function renderPanel(): void {
  view.zoomed = focus !== null;
  view.devVisible = config.dev && !config.bench && focus === null; // never covers the panel
  view.checkin.visible = !config.bench && focus === null;
  document.body.classList.toggle("zoomed", focus !== null);
  if (focus === null) view.panel = null;
  else if (selected !== null) {
    const r = regionOf(selected);
    view.panel = {
      title: countryName.of(selected) ?? selected,
      mood: moodOf(r && !r.quiet ? r.region.h : null),
      sub: !r
        ? "No check-ins yet"
        : r.quiet
          ? `Quiet here: showing ${CONTINENT_NAMES[focus]}`
          : `${r.region.n} check-ins`,
      bars: r ? barsOf(r.region) : [],
    };
  } else {
    const r = snapshot.continents[focus];
    view.panel = {
      title: CONTINENT_NAMES[focus],
      mood: moodOf(r ? r.h : null),
      sub: r ? `${r.n} check-ins` : "Quiet here",
      bars: r ? barsOf(r) : [],
    };
  }
  // Render now so a measurement that follows reads the new DOM. Defensive: today's callers also
  // get corrected by the ResizeObserver (a mutation removing this passed the layout tests).
  flushSync();
}

/** Bring the world headline back with the CURRENT world mood, animated. */
function replayWorldHeadline(): void {
  view.worldMood = MOODS[snapshot.world.h] ?? "";
  view.worldSwap++;
}

/** True between a tap and the start of its glide (one frame), so callers never see "arrived". */
let fitPending = false;
function enter(c: Continent): void {
  focus = c;
  fitPending = true;
  selected = null;
  recomputeFills();
  recomputeWeather();
  renderPanel();
  // Fit once the card has its final size, so the continent lands beside it, not under it.
  requestAnimationFrame(() => {
    fitPending = false;
    if (focus !== c) return; // left again before the frame
    measureLayout();
    camera.glideTo(fitFrame(c));
  });
}

function leave(): void {
  focus = null;
  selected = null;
  camera.glideTo({ center: [camera.view.center[0], 15], zoom: 1, offset: [0, 0] });
  recomputeFills();
  recomputeWeather();
  renderPanel();
  measureLayout();
  replayWorldHeadline();
}

// ---- Input: drag + fling, tap to drill down, pinch/wheel stretch between world and continent ---
let lods: Record<LodName, Lod>;
let particles: ParticleField;
let dirty = true;
let dragging = false;
let lastInput = performance.now();
/**
 * Recent drag moves, for the release velocity: averaged over a window, not the last pair of
 * events. One pair is noisy (timestamp jitter), and where moves arrive in a burst (Chrome aligns
 * them to frames, but not every browser or input path does) one tiny gap would read a normal
 * swipe as thousands of degrees per second. Capped as a last guard.
 */
const moves: { t: number; dLon: number; dLat: number }[] = [];
const VELOCITY_WINDOW_MS = 100;
const MAX_FLING_DEG_S = 720;
let last: { x: number; y: number; t: number } | null = null;
let downAt: { x: number; y: number } | null = null;
/** Active pointers (CSS px), for two-finger pinch. */
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { startDist: number } | null = null;

/** Country and continent under a screen point (CSS px), or null for ocean/space. */
function hitAt(
  x: number,
  y: number,
): { code: string; continent: Continent; lonLat: [number, number] } | null {
  const lonLat = projection.invert?.([x * dpr, y * dpr]);
  const [tx, ty] = projection.translate();
  if (!lonLat || Math.hypot(x * dpr - tx, y * dpr - ty) > projection.scale()) return null;
  const hit = lods["50m"].countries.find((f) => geoContains(f, lonLat));
  const code = hit ? String(hit.id) : null;
  const continent = code ? COUNTRY_TO_CONTINENT.get(code) : undefined;
  return code !== null && continent !== undefined
    ? { code, continent, lonLat: [lonLat[0], lonLat[1]] }
    : null;
}

/**
 * A zoom gesture let go (README §8.2.2). Free zoom would put the globe under the headline (the
 * "no text on the Earth" rule), so zoom moves between the two fitted levels: pulled far enough in
 * over a continent it drills in, far enough out it returns to the world; otherwise it springs back.
 */
function releaseStretch(at: { x: number; y: number }): void {
  const s = camera.releaseStretch();
  dirty = true;
  if (s > STRETCH_COMMIT && focus === null) {
    const hit = hitAt(at.x, at.y);
    if (hit) enter(hit.continent);
  } else if (s < -STRETCH_COMMIT && focus !== null) leave();
}

const pinchDist = () => {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};
const pinchMid = () => {
  const [a, b] = [...pointers.values()];
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
};

fxCanvas.addEventListener("pointerdown", (e) => {
  fxCanvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  camera.stop();
  lastInput = performance.now();
  if (pointers.size === 2) {
    // Second finger: the drag becomes a pinch; it is never a tap.
    dragging = false;
    downAt = null;
    pinch = { startDist: Math.max(1, pinchDist()) };
    return;
  }
  dragging = true;
  last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  downAt = { x: e.clientX, y: e.clientY };
  moves.length = 0;
});
fxCanvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInput = performance.now();
  if (pinch !== null) {
    camera.holdStretch(Math.log(pinchDist() / pinch.startDist));
    dirty = true;
    return;
  }
  if (!dragging || last === null) return;
  const k = 180 / Math.PI / (projection.scale() / dpr); // degrees per CSS px at the centre
  const dLon = -(e.clientX - last.x) * k;
  const dLat = (e.clientY - last.y) * k;
  camera.pan(dLon, dLat);
  moves.push({ t: e.timeStamp, dLon, dLat });
  while (moves.length > 0 && e.timeStamp - (moves[0] as { t: number }).t > VELOCITY_WINDOW_MS)
    moves.shift();
  last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  dirty = true;
});
const endDrag = (e: PointerEvent) => {
  const wasPinch = pinch !== null;
  const mid = pinchMid();
  pointers.delete(e.pointerId);
  lastInput = performance.now();
  dirty = true;
  if (wasPinch) {
    if (pointers.size < 2) {
      pinch = null;
      releaseStretch(mid);
    }
    return; // the finger left on the glass does not start a drag until it lifts
  }
  if (!dragging) return;
  dragging = false;
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
    const hit = hitAt(e.clientX, e.clientY);
    if (view.checkin.picking) {
      // The globe is the country picker: a tap on land places your pin; ocean does nothing.
      if (hit !== null) placePin(hit.code, hit.lonLat);
      return;
    }
    if (hit === null) {
      if (focus !== null) leave();
    } else if (focus !== hit.continent) enter(hit.continent);
    else {
      selected = hit.code;
      renderPanel(); // the ResizeObserver re-fits if the card's height changes
    }
    return;
  }
  // A pause before letting go leaves no moves in the window: velocity 0, no fling.
  camera.fling(...releaseVelocity(e.timeStamp));
};
/** Mean velocity (°/s) over the moves in the window before `now`, capped. */
function releaseVelocity(now: number): [number, number] {
  const recent = moves.filter((m) => now - m.t <= VELOCITY_WINDOW_MS);
  if (recent.length === 0) return [0, 0];
  // Span from the moment before the first counted move: at least one 60 Hz frame.
  const span = Math.max(1000 / 60, now - (recent[0] as { t: number }).t) / 1000;
  let lon = recent.reduce((a, m) => a + m.dLon, 0) / span;
  let lat = recent.reduce((a, m) => a + m.dLat, 0) / span;
  const speed = Math.hypot(lon, lat);
  if (speed > MAX_FLING_DEG_S) {
    lon *= MAX_FLING_DEG_S / speed;
    lat *= MAX_FLING_DEG_S / speed;
  }
  return [lon, lat];
}
fxCanvas.addEventListener("pointerup", endDrag);
fxCanvas.addEventListener("pointercancel", endDrag);

// Mouse wheel and trackpad pinch (ctrl+wheel) stretch the zoom the same way. One gesture lasts
// until the wheel is quiet for WHEEL_GESTURE_MS: long enough that a slow, deliberate scroll (a
// notch every ~200 ms) still adds up, short enough that a single notch springs back promptly.
const WHEEL_GESTURE_MS = 250;
let wheelRaw = 0;
let wheelTimer: ReturnType<typeof setTimeout> | undefined;
fxCanvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault(); // no page zoom on ctrl+wheel
    camera.stop();
    lastInput = performance.now();
    wheelRaw -= e.deltaY * (e.ctrlKey ? 0.01 : 0.0025);
    camera.holdStretch(wheelRaw);
    dirty = true;
    clearTimeout(wheelTimer);
    const at = { x: e.clientX, y: e.clientY };
    wheelTimer = setTimeout(() => {
      wheelRaw = 0;
      releaseStretch(at);
    }, WHEEL_GESTURE_MS);
  },
  { passive: false },
);

// ---- Dev switcher: preview any theme, or let the demo cycle (buttons in ui/App.svelte) -------
let autoCycle = !config.bench && params.get("auto") !== "0";
let cycleAt = performance.now();
view.autoCycle = autoCycle;
view.devVisible = config.dev && !config.bench;
view.checkin.visible = !config.bench;
document.body.classList.toggle("dev", view.devVisible);

// ---- Frame loop -------------------------------------------------------------------------------
let prevTs = 0;
let perfAt = 0;
let stepAt = 0;
let lastFrameMs = 0;
let idleRotating = false;
let wasAnimating = false;
let bench: { start: number; recorder: FrameRecorder; resolve: (s: FrameSummary) => void } | null =
  null;
/** Intervals recorded while idle (no drag), to measure the frame rate Chrome actually delivers. */
let idle: number[] | null = null;
/** Per idle frame: script ms, whether the base layer was redrawn, and at which LOD (diagnostics). */
let idleFrames: { script: number; base: boolean; lod: string; rotating: boolean }[] | null = null;
let drewBase = false;
/** Whether the globe is still easing to a new layout position (exposed for the layout test). */
let layoutEasing = false;
/** Whether the last frame drew mood-weather particles (off under reduced motion). */
let particlesDrawn = false;

function frame(ts: number): void {
  const t0 = performance.now();
  idleRotating = false;
  const dt = prevTs === 0 ? 0 : Math.min((ts - prevTs) / 1000, 0.05);

  // Demo data: one aggregation run every 2 s; the world bias moves every 20 s.
  if (!config.bench && ts - stepAt > 2000) {
    stepAt = ts;
    if (autoCycle && ts - cycleAt > 20_000) {
      cycleAt = ts;
      sim.bias = ((sim.bias + 1) % MOOD_COUNT) as MoodId;
    }
    onSnapshot(sim.step());
  }

  if (bench) {
    // Deterministic "drag": constant spin plus a wobble, identical on every run.
    const t = (ts - bench.start) / 1000;
    camera.view = { center: [10 - 90 * t, 20 - 15 * Math.sin(t * 1.3)], zoom: 1 };
    dirty = true;
  } else if (camera.update(dt)) {
    dirty = true; // glide, fling or stretch (fixed step, packages/motion)
  } else if (
    !dragging &&
    focus === null &&
    !view.checkin.picking && // hold still while you aim at your country
    !reducedMotion &&
    performance.now() - lastInput > 4000
  ) {
    camera.pan(-4 * dt, 0); // idle life: slow rotation
    idleRotating = true;
    dirty = true;
  }

  const themeChanging = mixer.update(dt);
  if (themeChanging) {
    recomputeFills();
    const th = mixer.current;
    view.themeName = th.name;
    ui.overlays.scanlines.style.opacity = th.scanlines.toFixed(3);
    ui.overlays.frost.style.opacity = th.frost.toFixed(3);
    ui.overlays.heat.style.opacity = th.heat.toFixed(3);
    document.documentElement.style.setProperty("--accent", th.css.rim);
  }

  const anchorEasing = easeAnchor(dt);
  layoutEasing = anchorEasing;
  if (anchorEasing) dirty = true;
  applyCamera();
  const moving = bench !== null || dragging || camera.moving || idleRotating;
  // Any frame that is part of an animation uses the light map; the detailed 50m map (~80k
  // points) is drawn once, when everything has settled. Before this, the theme cross-fade and
  // layout easing redrew 50m every frame: 7–8 full redraws in a 2 s "idle" window, 531 ms
  // frames at 4× on the Pixel (2026-11-07 gate run).
  const animating = moving || anchorEasing || themeChanging;
  if (wasAnimating && !animating) dirty = true; // settle: one detailed redraw
  wasAnimating = animating;
  // Zoomed into a continent the simplified outline is visibly crude, and culling already skips
  // the far side, so zoomed animation frames use 110m (docs/bench: zoom comparison).
  const moveLod = config.dragLod === "move" && camera.view.zoom > 1.5 ? "110m" : config.dragLod;
  const lod = lods[animating ? moveLod : "50m"];
  const tBase = performance.now();
  drewBase = dirty;
  if (dirty) {
    const th = mixer.current.css;
    globe.draw(
      lod,
      (code) => fills.get(code) ?? th.land,
      colorVersion,
      selected,
      {
        cull: config.opt.has("cull"),
        borders: !(moving && config.opt.has("noborders")),
        viewCenter: camera.view.center,
      },
      {
        skyInner: th.skyInner,
        skyOuter: th.skyOuter,
        ocean: th.ocean,
        neutral: th.land,
        border: th.border,
        edge: th.rim,
      },
    );
    dirty = false;
  }

  const tFx = performance.now();
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  const [cx, cy] = projection.translate();
  const r = projection.scale();
  // Breathing atmosphere (idle life), on the FX layer so the base layer can stay static.
  const breath = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(ts / 1400);
  const halo = fxCtx.createRadialGradient(cx, cy, r * 0.97, cx, cy, r * 1.16);
  halo.addColorStop(0, oklabToCss(mixer.current.lab.rim, 0.28 + 0.12 * breath));
  halo.addColorStop(1, oklabToCss(mixer.current.lab.rim, 0));
  fxCtx.fillStyle = halo;
  fxCtx.beginPath();
  fxCtx.arc(cx, cy, r * 1.16, 0, Math.PI * 2);
  fxCtx.arc(cx, cy, r * 0.97, 0, Math.PI * 2, true);
  fxCtx.fill();
  particlesDrawn = !reducedMotion;
  if (!reducedMotion) {
    particles.update(dt);
    const [rl, rp] = projection.rotate();
    particles.draw(fxCtx, [rl, rp], cx, cy, r, MOOD_COLORS, dpr);
  }
  ripples.update(dt);
  if (ripples.active) {
    // Rings are small circles on the sphere, so they bend over the horizon (clipped at 90°).
    for (const ring of ripples.rings()) {
      fxCtx.beginPath();
      fxPath(ringShape.center([ring.center[0], ring.center[1]]).radius(ring.radius)());
      fxCtx.globalAlpha = ring.alpha;
      fxCtx.strokeStyle = ring.color;
      fxCtx.lineWidth = (3 - ring.index * 0.8) * dpr;
      fxCtx.stroke();
    }
    fxCtx.globalAlpha = 1;
  }
  drawPin(dt);

  const tEnd = performance.now();
  lastFrameMs = tEnd - t0;
  if (idle && prevTs !== 0) idle.push(ts - prevTs);
  if (idleFrames && prevTs !== 0)
    idleFrames.push({ script: lastFrameMs, base: drewBase, lod: lod.name, rotating: idleRotating });
  if (bench && prevTs !== 0) {
    const elapsed = (ts - bench.start) / 1000;
    // skip 1 s warm-up
    if (elapsed > 1) bench.recorder.push(ts - prevTs, lastFrameMs, tFx - tBase, tEnd - tFx);
    if (elapsed > config.benchSeconds + 1) {
      const b = bench;
      bench = null;
      b.resolve(b.recorder.summary(1000 / config.expectedHz));
    }
  }
  if ((config.debug || config.bench) && ts - perfAt > 500) {
    perfAt = ts;
    perf.textContent = `script ${lastFrameMs.toFixed(2)} ms\nparticles ${config.particles}\nDPR ${dpr.toFixed(2)} (cap ${config.dprCap})\nLOD ${lod.name} · zoom ${camera.view.zoom.toFixed(2)}`;
  }
  prevTs = ts;
  requestAnimationFrame(frame);
}

// ---- Check-in moment (README §8.2.5) ----------------------------------------------------------
const ripples = new Ripples();
const ringShape = geoCircle().precision(4);
const fxPath = geoPath(projection, fxCtx);
let flightId = 0;
/** Where your face lands and the ripple starts: your country's centre. */
let landing: { center: [number, number]; mood: MoodId; first: boolean } | null = null;

/** Your pin: the exact spot you tapped, or your country's pin point when guessed or searched. */
let myPin: { code: string; lonLat: [number, number] } | null = null;
/** Pin points per country (inside the country, on its largest landmass), set at start(). */
let pinPoints = new Map<string, [number, number]>();
/** The pin drop: a bouncy spring on its height above the ground (CSS px), on the fixed step. */
const pinDrop = new Spring(0, SPRING.bouncy);
const pinStep = new FixedStep();

const PIN_KEY = "we.pin";
const countryNames = new Intl.DisplayNames([navigator.language, "en"], { type: "region" });
view.checkin.countries = [...COUNTRY_TO_CONTINENT.keys()]
  .map((code) => ({ code, name: countryNames.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Restore the saved pin or guess the country (M2); called once pin points are known. */
function initPin(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? "null") as unknown;
    const p = saved as { code?: unknown; lon?: unknown; lat?: unknown } | null;
    if (
      p &&
      typeof p.code === "string" &&
      COUNTRY_TO_CONTINENT.has(p.code) &&
      typeof p.lon === "number" &&
      typeof p.lat === "number" &&
      Math.abs(p.lat) <= 90
    ) {
      myPin = { code: p.code, lonLat: [p.lon, p.lat] };
    }
  } catch {
    // storage blocked or corrupt: fall back to the guess
  }
  if (myPin === null) {
    const code = guessCountry(navigator.languages, COUNTRY_TO_CONTINENT);
    const at = code === null ? undefined : pinPoints.get(code);
    if (code !== null && at !== undefined) myPin = { code, lonLat: at };
  }
  view.checkin.country = myPin?.code ?? null;
}

/** Put your pin down (a tap on the globe, or a search result) and drop it in with a bounce. */
function placePin(code: string, lonLat: [number, number]): void {
  if (!COUNTRY_TO_CONTINENT.has(code)) return;
  myPin = { code, lonLat };
  view.checkin.country = code;
  view.checkin.picking = false;
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify({ code, lon: lonLat[0], lat: lonLat[1] }));
  } catch {
    // a per-device convenience only
  }
  pinDrop.value = reducedMotion ? 0 : 46;
  pinDrop.velocity = 0;
  pinDrop.target = 0;
  dirty = true;
}

function setCountry(code: string): void {
  const at = pinPoints.get(code);
  if (at === undefined) return;
  placePin(code, at);
  camera.glideTo({ center: at, zoom: 1, offset: [0, 0] }); // show where it went
}

function startPick(): void {
  view.checkin.picking = true;
  lastInput = performance.now();
  // "The globe spins to you": bring your current pin (if any) to the front to start from.
  if (myPin !== null) camera.glideTo({ center: myPin.lonLat, zoom: 1, offset: [0, 0] });
  dirty = true;
}

/** "You are here": a pin on the FX layer, hidden when it is round the back of the globe. */
function drawPin(dt: number): void {
  if (myPin === null) return;
  pinStep.advance(dt, (h) => pinDrop.step(h));
  if (Math.abs(pinDrop.value) < 0.05 && Math.abs(pinDrop.velocity) < 0.05) pinDrop.snap();
  if (geoDistance(myPin.lonLat, camera.rendered.center) > Math.PI / 2 - 0.05) return;
  const p = projection(myPin.lonLat);
  if (!p) return;
  const [x, y0] = p;
  const y = y0 - pinDrop.value * dpr;
  const k = dpr;
  fxCtx.fillStyle = "rgba(0, 0, 0, 0.35)"; // shadow on the ground, under the pin
  fxCtx.beginPath();
  fxCtx.ellipse(x, y0, 4 * k, 1.6 * k, 0, 0, Math.PI * 2);
  fxCtx.fill();
  fxCtx.fillStyle = mixer.current.css.rim; // the theme accent, without a per-frame style read
  fxCtx.strokeStyle = "#0a0c10";
  fxCtx.lineWidth = 1.2 * k;
  fxCtx.beginPath();
  fxCtx.moveTo(x, y);
  fxCtx.bezierCurveTo(x - 7 * k, y - 9 * k, x - 7 * k, y - 18 * k, x, y - 18 * k);
  fxCtx.bezierCurveTo(x + 7 * k, y - 18 * k, x + 7 * k, y - 9 * k, x, y);
  fxCtx.fill();
  fxCtx.stroke();
  fxCtx.fillStyle = "#0a0c10";
  fxCtx.beginPath();
  fxCtx.arc(x, y - 12.5 * k, 2.2 * k, 0, Math.PI * 2);
  fxCtx.fill();
}

function checkIn(mood: MoodId, from: { x: number; y: number }): void {
  if (myPin === null) return;
  const { code, lonLat } = myPin;
  const first = view.checkin.mine === null;
  sim.checkIn(code, mood); // counted from the next aggregation run, like the real pipeline
  view.checkin.mine = mood;
  lastInput = performance.now();
  // Turn your pin to the front; the face lands where it will be (the globe's centre).
  camera.glideTo({ center: lonLat, zoom: 1, offset: [0, 0] });
  dirty = true;
  landing = { center: lonLat, mood, first };
  if (reducedMotion) {
    landed(-1); // no pop, flight or ripple: the chip cross-fades in and the count updates
    return;
  }
  flightId++;
  view.flight = {
    id: flightId,
    mood,
    from,
    to: { x: anchorGoal.x / dpr, y: anchorGoal.y / dpr },
  };
}

function landed(id: number): void {
  if (view.flight !== null && view.flight.id !== id) return; // a newer flight replaced it
  view.flight = null;
  const l = landing;
  landing = null;
  if (l === null) return;
  // A first check-in adds one; a change of mood replaces your vote. Never below the snapshot.
  view.worldCount = Math.max(view.worldCount + (l.first ? 1 : 0), snapshot.world.n);
  if (reducedMotion) return;
  ripples.add(l.center, MOOD_COLORS[l.mood] ?? "#fff");
  // Android; iOS has no vibration API (README §8.6). 30 ms: 12 ms could not be felt on a Pixel 6 Pro.
  navigator.vibrate?.(30);
}

/** Re-measure; if the card's visible height changed, re-fit the continent beside it. */
function refitToCard(): void {
  const before = lastCardH;
  measureLayout();
  if (focus !== null && Math.abs(lastCardH - before) > 8 && !camera.gliding)
    camera.glideTo(fitFrame(focus), 0.5);
  dirty = true;
}

// ---- Startup ----------------------------------------------------------------------------------
async function start(): Promise<void> {
  const [m, a, b] = await Promise.all([
    loadMoveLod(config.moveKeep),
    loadLod("110m"),
    loadLod("50m"),
  ]);
  lods = { move: m, "110m": a, "50m": b };
  pinPoints = new Map(b.countries.map((f) => [String(f.id), pinPoint(f)]));
  initPin();
  centroids = b.countries.map((f) => {
    const [lon, lat] = geoCentroid(f);
    return { code: String(f.id), lon, lat };
  });
  particles = new ParticleField(config.particles, [], rng(42));
  perf.hidden = !(config.debug || config.bench);
  resize();
  layoutReady = true;
  mixer.setTarget(snapshot.world.h, true);
  view.themeName = mixer.current.name;
  onSnapshot(snapshot);
  const th = mixer.current;
  ui.overlays.scanlines.style.opacity = String(th.scanlines);
  ui.overlays.frost.style.opacity = String(th.frost);
  ui.overlays.heat.style.opacity = String(th.heat);
  document.documentElement.style.setProperty("--accent", th.css.rim);
  window.addEventListener("resize", resize);
  // Any change in the size of text/UI (content, fonts, rotation) re-measures the free area.
  // Fires only on actual size changes, never per frame.
  const ro = new ResizeObserver(refitToCard);
  for (const el of [header, ui.panel, ui.back, ui.dev, ui.checkin]) ro.observe(el);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) prevTs = 0; // don't integrate the time spent hidden
  });
  requestAnimationFrame(frame);
}

/**
 * Deterministic correctness check for render optimisations: draw the same pose twice (reference
 * vs. variant) into offscreen canvases, without particles, and count differing pixels. Culling
 * must give exactly 0 at every pose, because it may only skip features that are not visible.
 */
async function verifyRender(variant: {
  cull: boolean;
  precision0: boolean;
  /** Self-test: cull against the wrong view centre. Must report large differences. */
  selfTestWrongCenter?: boolean;
}) {
  await ready;
  const size = 600;
  const make = (precision0: boolean) => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    const proj = geoOrthographic()
      .clipAngle(90)
      .scale(size * 0.45)
      .translate([size / 2, size / 2]);
    if (precision0) proj.precision(0);
    return { ctx, proj, layer: new GlobeLayer(ctx, proj) };
  };
  const fixedColor = (code: string) =>
    MOOD_COLORS[((code.charCodeAt(0) * 31 + code.charCodeAt(1)) >>> 0) % MOOD_COUNT] ?? "#000";
  const ref = make(false);
  const alt = make(variant.precision0);
  let worst = { px: 0, rotate: [0, 0] as [number, number] };
  /** Per map: precision0 is exact on 110m/50m, but draws the long simplified edges as chords. */
  const worstByLod: Record<string, number> = {};
  let poses = 0;
  for (const res of ["move", "110m", "50m"] as const) {
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -60; lat <= 60; lat += 30) {
        const rotate: [number, number] = [lon, lat];
        for (const x of [ref, alt]) x.proj.rotate(rotate);
        const viewCenter: [number, number] = [-lon, -lat];
        ref.layer.draw(lods[res], fixedColor, 0, null, { cull: false, borders: true, viewCenter });
        alt.layer.draw(lods[res], fixedColor, 0, null, {
          cull: variant.cull,
          borders: true,
          viewCenter: variant.selfTestWrongCenter ? [lon, lat] : viewCenter,
        });
        const p = ref.ctx.getImageData(0, 0, size, size).data;
        const q = alt.ctx.getImageData(0, 0, size, size).data;
        let px = 0;
        for (let i = 0; i < p.length; i += 4) {
          if (
            Math.abs((p[i] ?? 0) - (q[i] ?? 0)) > 8 ||
            Math.abs((p[i + 1] ?? 0) - (q[i + 1] ?? 0)) > 8 ||
            Math.abs((p[i + 2] ?? 0) - (q[i + 2] ?? 0)) > 8
          )
            px++;
        }
        poses++;
        if (px > worst.px) worst = { px, rotate };
        worstByLod[res] = Math.max(worstByLod[res] ?? 0, px);
      }
    }
  }
  return { poses, worstPx: worst.px, worstRotate: worst.rotate, worstByLod, totalPx: size * size };
}

// ---- Benchmark API for tools/bench ------------------------------------------------------------
declare global {
  interface Window {
    __bench?: {
      ready: Promise<void>;
      verifyRender: typeof verifyRender;
      /** CSS-pixel position of a lon/lat on screen (null if on the far side), for scripted taps. */
      screenPoint(lon: number, lat: number): [number, number] | null;
      /** Point the camera at a lon/lat (scripted tours). */
      face(lon: number, lat: number): void;
      /** Run one demo aggregation now (tests: force a snapshot at a chosen moment). */
      aggregate(): void;
      /** Real on-screen layout in CSS px, for the browser layout test. */
      layout(): {
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
      };
      run(): Promise<FrameSummary & { config: unknown; dpr: number; idleIntervalP50: number }>;
    };
  }
}

const ready = start();
window.__bench = {
  ready,
  verifyRender,
  layout() {
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
    return {
      globe: { cx: tx / dpr, cy: ty / dpr, r: projection.scale() / dpr, halo: HALO },
      focus,
      focusBox,
      gliding: camera.gliding || fitPending,
      center: [camera.view.center[0], camera.view.center[1]],
      zoom: camera.rendered.zoom,
      moving: camera.moving || dragging,
      particles: particlesDrawn,
      easing: layoutEasing,
      ripple: ripples.active,
      pin: myPin ? [myPin.lonLat[0], myPin.lonLat[1]] : null,
      worldMood: MOODS[snapshot.world.h] ?? "",
    };
  },
  aggregate() {
    onSnapshot(sim.step());
  },
  face(lon, lat) {
    camera.stop();
    // Hold idle rotation until the next real input: otherwise, under load, the globe turns
    // between a test reading a point's position and its tap landing there.
    lastInput = Number.POSITIVE_INFINITY;
    camera.view = { center: [lon, lat], zoom: camera.view.zoom };
    lastInput = performance.now();
    dirty = true;
  },
  screenPoint(lon, lat) {
    const p = projection([lon, lat]);
    return p ? [p[0] / dpr, p[1] / dpr] : null;
  },
  async run() {
    await ready;
    // Idle probe: 2 s with nothing moving shows the frame rate Chrome actually gives this page.
    idle = [];
    idleFrames = [];
    await new Promise((r) => setTimeout(r, 2000));
    const samples = idle.sort((a, b) => a - b);
    idle = null;
    const idleDiag = idleFrames;
    idleFrames = null;
    const idleIntervalP50 = samples[Math.floor(samples.length / 2)] ?? Number.NaN;
    const recorder = new FrameRecorder(Math.ceil((config.benchSeconds + 2) * 150));
    const summary = await new Promise<FrameSummary>((resolve) => {
      bench = { start: performance.now(), recorder, resolve };
    });
    const n = idleDiag.length;
    const idleDetail = {
      frames: n,
      scriptP50:
        [...idleDiag].map((f) => f.script).sort((a, b) => a - b)[Math.floor(n / 2)] ?? Number.NaN,
      baseRedraws: idleDiag.filter((f) => f.base).length,
      lods: [...new Set(idleDiag.map((f) => f.lod))],
      rotatingFrames: idleDiag.filter((f) => f.rotating).length,
    };
    return {
      ...summary,
      config: { ...config, opt: [...config.opt] },
      points: { move: pointCount(lods.move), "110m": pointCount(lods["110m"]) },
      dpr,
      idleIntervalP50,
      idleDetail,
    };
  },
};
