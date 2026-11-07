import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import {
  type Continent,
  MOOD_COUNT,
  MOODS,
  type MoodId,
  type Snapshot,
  type SnapshotRegion,
} from "@world-emotion/shared";
import { geoCentroid, geoContains, geoDistance, geoOrthographic } from "d3-geo";
import { SnapshotSim } from "./demo/snapshot-sim";
import { Camera, CONTINENT_NAMES, CONTINENT_VIEWS, type View } from "./engine/camera";
import { hexToOklab, mixOklab, oklabToCss } from "./engine/color";
import { type Lod, type LodName, loadLod, loadMoveLod, pointCount } from "./engine/geo";
import { GlobeLayer } from "./engine/globe-layer";
import { fitGlobe, fitRegion, freeArea, HALO, type Rect } from "./engine/layout";
import { MOOD_COLORS } from "./engine/palette";
import { ParticleField, rng, type SpawnPoint } from "./engine/particles";
import { FrameRecorder, type FrameSummary } from "./engine/stats";
import { ThemeMixer } from "./engine/themes";

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
};
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- DOM --------------------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const baseCanvas = $<HTMLCanvasElement>("base");
const fxCanvas = $<HTMLCanvasElement>("fx");
const perf = $("perf");
const baseCtx = baseCanvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
const fxCtx = fxCanvas.getContext("2d") as CanvasRenderingContext2D;
const ui = {
  worldMood: $("world-mood"),
  themeName: $("theme-name"),
  back: $<HTMLButtonElement>("back"),
  panel: $("panel"),
  panelTitle: $("panel-title"),
  panelMood: $("panel-mood"),
  panelSub: $("panel-sub"),
  bars: $("bars"),
  dev: $("dev"),
  overlays: { scanlines: $("scanlines"), frost: $("frost"), heat: $("heat") },
};
const countryName = new Intl.DisplayNames([navigator.language, "en"], { type: "region" });

// ---- Globe ------------------------------------------------------------------------------------
const projection = geoOrthographic().clipAngle(90);
if (config.opt.has("precision0")) projection.precision(0);
const globe = new GlobeLayer(baseCtx, projection);
const camera = new Camera({ center: [10, 20], zoom: 1 });
let dpr = 1;
/** Globe radius at zoom 1 (canvas px): the largest globe whose halo fits the world free area. */
let baseRadius = 1;

// ---- Layout: text never sits on the Earth (engine/layout.ts, e2e/layout.spec.ts) --------------
const header = document.querySelector("header") as HTMLElement;
/** Projection centre (canvas px), eased toward `anchorGoal` so layout changes glide too. */
const anchor = { x: 0, y: 0 };
let anchorGoal = { x: 0, y: 0 };
let regionFree: Rect | null = null;
let lastDev: Rect | null = null;
let lastCardH = 0;

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
  if (!ui.dev.hidden) lastDev = boxOf(ui.dev);
  const world = fitGlobe(freeArea({ viewport, top: boxOf(header), bottom: lastDev }));
  baseRadius = world.r * dpr;
  if (focus === null || ui.panel.hidden) {
    regionFree = null;
    anchorGoal = { x: world.cx * dpr, y: world.cy * dpr };
    return;
  }
  const wide = SIDE_CARD.matches;
  const card = boxOf(ui.panel);
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
  const [lon, lat] = camera.view.center;
  const scale = baseRadius * camera.view.zoom;
  const [ox, oy] = camera.view.offset ?? [0, 0];
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
    ui.worldMood.classList.remove("swap");
    void ui.worldMood.offsetWidth; // restart the CSS animation
    ui.worldMood.classList.add("swap");
  }
  ui.worldMood.textContent = MOODS[next.world.h] ?? "";
  recomputeFills();
  recomputeWeather();
  renderPanel();
}

// ---- Panels -----------------------------------------------------------------------------------
function renderBars(r: SnapshotRegion): void {
  ui.bars.replaceChildren(
    ...MOODS.map((name, m) => {
      const li = document.createElement("li");
      const pct = Math.round((r.dist[m] ?? 0) * 100);
      li.innerHTML = `<span class="label">${name}</span><span class="track"><span class="fill"></span></span><span class="pct">${pct}%</span>`;
      const fill = li.querySelector(".fill") as HTMLElement;
      fill.style.background = MOOD_COLORS[m] ?? "#fff";
      // Compositor-only animation (README §8.1 layer 4): scaleX, never width.
      requestAnimationFrame(() => {
        fill.style.transform = `scaleX(${(r.dist[m] ?? 0).toFixed(3)})`;
      });
      if (m === r.h) li.classList.add("lead");
      return li;
    }),
  );
}

/** "feels <mood>", with the mood word in its own colour (it is always named, never colour alone). */
function setPanelMood(m: MoodId | null): void {
  if (m === null) {
    ui.panelMood.textContent = "";
    return;
  }
  const word = document.createElement("span");
  word.textContent = MOODS[m] ?? "";
  word.style.color = MOOD_COLORS[m] ?? "";
  ui.panelMood.replaceChildren("feels ", word);
}

function renderPanel(): void {
  ui.back.hidden = focus === null;
  ui.dev.hidden = config.bench || focus !== null; // prototype bar never covers the panel
  document.body.classList.toggle("zoomed", focus !== null);
  if (focus === null) {
    ui.panel.hidden = true;
    return;
  }
  ui.panel.hidden = false;
  if (selected !== null) {
    const r = regionOf(selected);
    ui.panelTitle.textContent = countryName.of(selected) ?? selected;
    setPanelMood(r && !r.quiet ? r.region.h : null);
    ui.panelSub.textContent = !r
      ? "No check-ins yet"
      : r.quiet
        ? `Quiet here: showing ${CONTINENT_NAMES[focus]}`
        : `${r.region.n} check-ins`;
    if (r) renderBars(r.region);
    else ui.bars.replaceChildren();
    return;
  }
  const r = snapshot.continents[focus];
  ui.panelTitle.textContent = CONTINENT_NAMES[focus];
  setPanelMood(r ? r.h : null);
  ui.panelSub.textContent = r ? `${r.n} check-ins` : "Quiet here";
  if (r) renderBars(r);
  else ui.bars.replaceChildren();
}

/** Bring the world headline back with the CURRENT world mood, animated. */
function replayWorldHeadline(): void {
  ui.worldMood.textContent = MOODS[snapshot.world.h] ?? "";
  ui.worldMood.classList.remove("swap");
  void ui.worldMood.offsetWidth; // restart the CSS animation
  ui.worldMood.classList.add("swap");
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
ui.back.addEventListener("click", leave);

// ---- Input: drag with crude inertia (Phase 4 replaces this), tap to drill down ---------------
let lods: Record<LodName, Lod>;
let particles: ParticleField;
let dirty = true;
let dragging = false;
let lastInput = performance.now();
let velocity: [number, number] = [0, 0];
let last: { x: number; y: number; t: number } | null = null;
let downAt: { x: number; y: number } | null = null;

fxCanvas.addEventListener("pointerdown", (e) => {
  fxCanvas.setPointerCapture(e.pointerId);
  dragging = true;
  camera.stop();
  last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  downAt = { x: e.clientX, y: e.clientY };
  velocity = [0, 0];
  lastInput = performance.now();
});
fxCanvas.addEventListener("pointermove", (e) => {
  if (!dragging || last === null) return;
  const k = 180 / Math.PI / (projection.scale() / dpr); // degrees per CSS px at the centre
  const dLon = -(e.clientX - last.x) * k;
  const dLat = (e.clientY - last.y) * k;
  camera.pan(dLon, dLat);
  const dt = Math.max(1, e.timeStamp - last.t);
  velocity = [(dLon / dt) * 1000, (dLat / dt) * 1000];
  last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  lastInput = performance.now();
  dirty = true;
});
const endDrag = (e: PointerEvent) => {
  if (!dragging) return;
  dragging = false;
  dirty = true;
  lastInput = performance.now();
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
    velocity = [0, 0];
    const lonLat = projection.invert?.([e.clientX * dpr, e.clientY * dpr]);
    const onGlobe =
      lonLat &&
      Math.hypot(
        e.clientX * dpr - projection.translate()[0],
        e.clientY * dpr - projection.translate()[1],
      ) <= projection.scale();
    const hit = onGlobe ? lods["50m"].countries.find((f) => geoContains(f, lonLat)) : undefined;
    const code = hit ? String(hit.id) : null;
    const continent = code ? COUNTRY_TO_CONTINENT.get(code) : undefined;
    if (code === null || continent === undefined) {
      if (focus !== null) leave();
    } else if (focus !== continent) enter(continent);
    else {
      selected = code;
      dirty = true;
      renderPanel(); // the ResizeObserver re-fits if the card's height changes
    }
  }
};
fxCanvas.addEventListener("pointerup", endDrag);
fxCanvas.addEventListener("pointercancel", endDrag);

// ---- Dev switcher: preview any theme, or let the demo cycle ----------------------------------
let autoCycle = !config.bench && params.get("auto") !== "0";
let cycleAt = performance.now();
ui.dev.hidden = config.bench;
ui.dev.replaceChildren(
  ...MOODS.map((name, m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.style.borderColor = MOOD_COLORS[m] ?? "#fff";
    b.addEventListener("click", () => {
      sim.bias = m as MoodId;
      autoCycle = false;
      autoBtn.textContent = "auto: off";
    });
    return b;
  }),
);
const autoBtn = document.createElement("button");
autoBtn.type = "button";
autoBtn.textContent = "auto: on";
autoBtn.addEventListener("click", () => {
  autoCycle = !autoCycle;
  cycleAt = performance.now();
  autoBtn.textContent = `auto: ${autoCycle ? "on" : "off"}`;
});
ui.dev.append(autoBtn);

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
    dirty = true;
  } else if (!dragging && (velocity[0] !== 0 || velocity[1] !== 0)) {
    camera.pan(velocity[0] * dt, velocity[1] * dt);
    const decay = Math.exp(-3 * dt);
    velocity = [velocity[0] * decay, velocity[1] * decay];
    if (Math.hypot(velocity[0], velocity[1]) < 1) velocity = [0, 0];
    dirty = true;
  } else if (
    !dragging &&
    focus === null &&
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
    ui.themeName.textContent = th.name;
    ui.overlays.scanlines.style.opacity = th.scanlines.toFixed(3);
    ui.overlays.frost.style.opacity = th.frost.toFixed(3);
    ui.overlays.heat.style.opacity = th.heat.toFixed(3);
    document.documentElement.style.setProperty("--accent", th.css.rim);
  }

  const anchorEasing = easeAnchor(dt);
  if (anchorEasing) dirty = true;
  applyCamera();
  const moving =
    bench !== null ||
    dragging ||
    camera.gliding ||
    idleRotating ||
    velocity[0] !== 0 ||
    velocity[1] !== 0;
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
  if (!reducedMotion) {
    particles.update(dt);
    const [rl, rp] = projection.rotate();
    particles.draw(fxCtx, [rl, rp], cx, cy, r, MOOD_COLORS, dpr);
  }

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

// ---- Startup ----------------------------------------------------------------------------------
async function start(): Promise<void> {
  const [m, a, b] = await Promise.all([
    loadMoveLod(config.moveKeep),
    loadLod("110m"),
    loadLod("50m"),
  ]);
  lods = { move: m, "110m": a, "50m": b };
  centroids = b.countries.map((f) => {
    const [lon, lat] = geoCentroid(f);
    return { code: String(f.id), lon, lat };
  });
  particles = new ParticleField(config.particles, [], rng(42));
  perf.hidden = !(config.debug || config.bench);
  resize();
  mixer.setTarget(snapshot.world.h, true);
  ui.themeName.textContent = mixer.current.name;
  onSnapshot(snapshot);
  const th = mixer.current;
  ui.overlays.scanlines.style.opacity = String(th.scanlines);
  ui.overlays.frost.style.opacity = String(th.frost);
  ui.overlays.heat.style.opacity = String(th.heat);
  document.documentElement.style.setProperty("--accent", th.css.rim);
  window.addEventListener("resize", resize);
  // Any change in the size of text/UI (content, fonts, rotation) re-measures the free area.
  // Fires only on actual size changes, never per frame.
  const ro = new ResizeObserver(() => {
    const before = lastCardH;
    measureLayout();
    if (focus !== null && Math.abs(lastCardH - before) > 8 && !camera.gliding)
      camera.glideTo(fitFrame(focus), 0.5);
    dirty = true;
  });
  for (const el of [header, ui.panel, ui.back, ui.dev]) ro.observe(el);
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
      /** Real on-screen layout in CSS px, for the browser layout test. */
      layout(): {
        globe: { cx: number; cy: number; r: number; halo: number };
        focus: Continent | null;
        focusBox: Rect | null;
        gliding: boolean;
        worldMood: string;
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
      worldMood: MOODS[snapshot.world.h] ?? "",
    };
  },
  face(lon, lat) {
    camera.stop();
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
