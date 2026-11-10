import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import { hexToOklab, oklabToCss, subsolarPoint } from "@world-emotion/motion";
import {
  type Continent,
  DEFAULT_CONFIG,
  MOODS,
  type MoodId,
  type Snapshot,
} from "@world-emotion/shared";
import { geoCentroid, geoOrthographic, geoPath } from "d3-geo";
import { flushSync, mount } from "svelte";
import { installTestHooks } from "./bench/hooks";
import type { FrameProbe } from "./bench/probe";
import { addEntry, type JournalEntry, lastWeek, loadJournal, saveJournal } from "./checkin/journal";
import { CheckInMoment } from "./checkin/moment";
import { readConfig } from "./config";
import { DemoSource } from "./data/demo-source";
import type { SnapshotSource } from "./data/snapshot-source";
import { DOCK_RIGHT_QUERY, REDUCED_MOTION_QUERY, SIDE_CARD_QUERY } from "./engine/breakpoints";
import { Camera, STRETCH_COMMIT } from "./engine/camera";
import { LayoutFit } from "./engine/fit";
import { CLIP_ANGLE, type Lod, type LodName, loadLod, loadMoveLod } from "./engine/geo";
import { GlobeLayer } from "./engine/globe-layer";
import { attachInput } from "./engine/input";
import { MOOD_COLORS } from "./engine/palette";
import { ParticleField, rng } from "./engine/particles";
import { pinPoint } from "./engine/pin";
import {
  alongside,
  countryFills,
  hitCountry,
  panelModel,
  themeFor,
  weatherSpawns,
  worldHeadline,
} from "./engine/regions";
import { ThemeMixer } from "./engine/themes";
import { i18n } from "./i18n/i18n.svelte";
import App from "./ui/App.svelte";
import { FLAG_CHECKED_IN, firstTime, HINT_TAP_COUNTRY, mark, seen } from "./ui/hints";
import { view } from "./ui/view.svelte";

/**
 * Composition root and frame loop. The pieces live beside it: data/ (where snapshots come from),
 * engine/ (fit, input, regions, drawing), checkin/ (the check-in moment), bench/ (test hooks and
 * the ?bench=1 harness). docs/design/phase-5.5-bridge.md, E1.
 */

// ---- Configuration (URL params, src/config.ts) ------------------------------------------------
const config = readConfig(new URLSearchParams(location.search));
const reducedMotion = matchMedia(REDUCED_MOTION_QUERY).matches;

// ---- Data source (src/data): demo for now; Phase 6 swaps in the polled snapshot + API -----------
// Demo cadence: one aggregation run every 2 s; the world's mood moves every 20 s unless ?auto=0.
// Bench runs never step on their own, so frames compare across runs.
const source: SnapshotSource = new DemoSource({
  autoCycle: config.autoCycle,
  paused: config.bench,
  now: performance.now(),
  ...(config.votes === undefined ? {} : { votes: config.votes }),
});
/** Below this many check-ins the world is quiet: no headline mood (ADR 0003, README §5.4). */
const QUIET_WORLD_BELOW = DEFAULT_CONFIG.publishMinN;

// ---- DOM --------------------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const baseCanvas = $<HTMLCanvasElement>("base");
const fxCanvas = $<HTMLCanvasElement>("fx");
const perf = $("perf");
const baseCtx = baseCanvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
const fxCtx = fxCanvas.getContext("2d") as CanvasRenderingContext2D;
/**
 * Layout callbacks from the UI are ignored until start() has measured once: a component may
 * report during mount (under reduced motion the card settles synchronously), before the
 * engine's element references and canvases exist.
 */
let layoutReady = false;
// The language is picked before the UI mounts, so the first paint is already in it.
i18n.init();
mount(App, {
  target: $("ui"),
  props: {
    actions: {
      back: () => leave(),
      previewMood: (m: MoodId) => {
        source.demo?.previewMood(m);
        view.autoCycle = source.demo?.autoCycle ?? false;
      },
      toggleAuto: () => {
        view.autoCycle = source.demo?.toggleAuto() ?? false;
      },
      checkIn: (mood: MoodId, from: { x: number; y: number }) => {
        moment.checkIn(mood, from);
        refreshResult();
        if (view.checkin.mine !== null && view.checkin.country !== null) {
          journal = addEntry(journal, { mood, at: new Date(), country: view.checkin.country });
          saveJournal(journal);
          refreshJournal();
        }
        if (view.checkin.mine !== null) {
          view.checkin.firstRun = false; // the place row goes back under the faces
          mark(FLAG_CHECKED_IN);
        }
      },
      setCountry: (code: string) => {
        moment.setCountry(code);
        refreshResult();
      },
      startPick: () => moment.startPick(),
      cancelPick: () => moment.cancelPick(),
      landed: (id: number) => moment.landed(id),
      clearJournal: () => {
        journal = [];
        saveJournal(journal);
        refreshJournal();
      },
      cardMoved: () => {
        if (layoutReady) refitToCard();
      },
    },
  },
});
flushSync();
/** Boxes the layout measures (ids kept stable for index.html CSS and e2e/layout.spec.ts). */
const ui = {
  header: document.querySelector("header") as HTMLElement,
  back: $<HTMLButtonElement>("back"),
  panel: $("panel"),
  dev: $("dev"),
  checkin: $("checkin"),
  overlays: { scanlines: $("scanlines"), frost: $("frost"), heat: $("heat") },
};

// ---- Globe, camera, layout --------------------------------------------------------------------
const projection = geoOrthographic().clipAngle(CLIP_ANGLE);
if (config.opt.has("precision0")) projection.precision(0);
const globe = new GlobeLayer(baseCtx, projection);
const camera = new Camera({ center: [10, 20], zoom: 1 }, { reducedMotion });
const fit = new LayoutFit(ui, matchMedia(DOCK_RIGHT_QUERY), matchMedia(SIDE_CARD_QUERY));
let dpr = 1;
let dirty = true;
let lastInput = performance.now();
const invalidate = () => {
  dirty = true;
};
const touched = () => {
  lastInput = performance.now();
};

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, config.dprCap);
  for (const c of [baseCanvas, fxCanvas]) {
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }
  fit.measure(focus, dpr);
  fit.snap();
  if (focus !== null) {
    camera.stop();
    camera.view = fit.fitFrame(focus, dpr);
  }
  dirty = true;
}

function applyCamera(): void {
  const v = camera.rendered; // includes a zoom gesture's rubber-band stretch
  const [lon, lat] = v.center;
  const scale = fit.baseRadius * v.zoom;
  const [ox, oy] = v.offset ?? [0, 0];
  projection
    .rotate([-lon, -lat])
    .scale(scale)
    .translate([fit.anchor.x - ox * scale, fit.anchor.y - oy * scale]);
}

// ---- Data → colours and weather ---------------------------------------------------------------
let snapshot: Snapshot = source.snapshot;
let headline = worldHeadline(snapshot, QUIET_WORLD_BELOW);
const mixer = new ThemeMixer(headline.theme, 2.5);
const moodLab = MOOD_COLORS.map(hexToOklab);
let fills = new Map<string, string>();
let colorVersion = 0;
let focus: Continent | null = null;
let selected: string | null = null;
let centroids: { code: string; lon: number; lat: number }[] = [];
let lods: Record<LodName, Lod> | undefined;
let particles: ParticleField;

function recomputeFills(): void {
  fills = countryFills(snapshot, COUNTRY_TO_CONTINENT, focus, mixer.current.lab, moodLab);
  colorVersion++;
  dirty = true;
}

function recomputeWeather(): void {
  particles.setSpawns(weatherSpawns(snapshot, centroids, COUNTRY_TO_CONTINENT, focus));
}

function onSnapshot(next: Snapshot): void {
  snapshot = next;
  headline = worldHeadline(next, QUIET_WORLD_BELOW);
  // Replay the word's entrance when the mood changes (not for the very first one).
  if (view.worldMood !== null && headline.mood !== view.worldMood) view.worldSwap++;
  retheme();
  view.worldQuiet = headline.quiet;
  view.worldMood = headline.mood;
  view.checkin.published = Object.keys(next.countries);
  refreshJournal(); // the window moves at midnight while the page stays open
  refreshResult();
  // Held still while your face is in flight: the landing ticks it (see CheckInMoment.landed).
  if (view.flight === null) view.worldCount = next.world.n;
  recomputeFills();
  recomputeWeather();
  renderPanel();
}

/** Your own check-ins, on this device only (bridge R2). The strip appears from the second day. */
let journal: JournalEntry[] = loadJournal();
function refreshJournal(): void {
  view.checkin.week = journal.length >= 2 ? lastWeek(journal, new Date()) : null;
}

/** The Earth follows the region in view (bridge T1): cross-fades when that region's mood differs. */
function retheme(): void {
  mixer.setTarget(themeFor(snapshot, focus, QUIET_WORLD_BELOW));
}

/** The line under "You feel …" (bridge R1): recomputed on every snapshot and every check-in. */
function refreshResult(): void {
  const mine = view.checkin.mine;
  const country = view.checkin.country;
  view.checkin.result =
    mine === null || country === null ? null : alongside(snapshot, country, mine);
}

function renderPanel(): void {
  view.zoomed = focus !== null;
  view.devVisible = config.dev && !config.bench && focus === null; // never covers the panel
  view.checkin.visible = !config.bench && focus === null;
  document.body.classList.toggle("zoomed", focus !== null);
  view.panel = panelModel(snapshot, focus, selected, COUNTRY_TO_CONTINENT, MOOD_COLORS);
  // Render now so a measurement that follows reads the new DOM. Defensive: today's callers also
  // get corrected by the ResizeObserver (a mutation removing this passed the layout tests).
  flushSync();
}

/** True between a tap and the start of its glide (one frame), so callers never see "arrived". */
let fitPending = false;
/** The country-tap hint stays this long on the first zoom (bridge U6). */
const HINT_MS = 4000;

function enter(c: Continent): void {
  focus = c;
  fitPending = true;
  selected = null;
  retheme();
  recomputeFills();
  recomputeWeather();
  renderPanel();
  if (firstTime(HINT_TAP_COUNTRY)) {
    view.hint = "tapCountry";
    setTimeout(() => {
      if (view.hint === "tapCountry") view.hint = null;
    }, HINT_MS);
  }
  // Fit once the card has its final size, so the continent lands beside it, not under it.
  requestAnimationFrame(() => {
    fitPending = false;
    if (focus !== c) return; // left again before the frame
    fit.measure(focus, dpr);
    camera.glideTo(fit.fitFrame(c, dpr));
  });
}

function leave(): void {
  focus = null;
  selected = null;
  view.hint = null;
  retheme();
  camera.glideTo({ center: [camera.view.center[0], 15], zoom: 1, offset: [0, 0] });
  recomputeFills();
  recomputeWeather();
  renderPanel();
  fit.measure(focus, dpr);
  // Bring the world headline back with the CURRENT world mood, animated.
  view.worldQuiet = headline.quiet;
  view.worldMood = headline.mood;
  view.worldSwap++;
}

/** Re-measure; if the card's visible height changed, re-fit the continent beside it. */
function refitToCard(): void {
  const before = fit.cardH;
  fit.measure(focus, dpr);
  if (focus !== null && Math.abs(fit.cardH - before) > 8 && !camera.gliding)
    camera.glideTo(fit.fitFrame(focus, dpr), 0.5);
  dirty = true;
}

// ---- Check-in moment and input ----------------------------------------------------------------
const fxPath = geoPath(projection, fxCtx);
const moment = new CheckInMoment({
  camera,
  projection,
  fx: fxCtx,
  fxPath,
  reducedMotion,
  source,
  known: COUNTRY_TO_CONTINENT,
  accent: () => mixer.current.css.rim,
  landingPoint: () => ({ x: fit.goal.x / dpr, y: fit.goal.y / dpr }),
  dpr: () => dpr,
  worldN: () => snapshot.world.n,
  invalidate,
  touched,
});
// Codes only: the check-in bar names and sorts them in the active language.
view.checkin.countries = [...COUNTRY_TO_CONTINENT.keys()];

const hitAt = (x: number, y: number) =>
  hitCountry(x, y, {
    projection,
    dpr,
    countries: lods?.["50m"].countries,
    map: COUNTRY_TO_CONTINENT,
  });

const input = attachInput(fxCanvas, {
  camera,
  degreesPerPx: () => 180 / Math.PI / (projection.scale() / dpr),
  touched,
  invalidate,
  onTap(at) {
    const hit = hitAt(at.x, at.y);
    if (view.checkin.picking) {
      // The globe is the country picker: a tap on land places your pin; ocean does nothing.
      if (hit !== null) {
        moment.placePin(hit.code, hit.lonLat);
        refreshResult();
      }
      return;
    }
    if (hit === null) {
      if (focus !== null) leave();
    } else if (focus !== hit.continent) enter(hit.continent);
    else {
      selected = hit.code;
      view.hint = null; // they found it
      renderPanel(); // the ResizeObserver re-fits if the card's height changes
    }
  },
  /**
   * A zoom gesture let go (README §8.2.2). Free zoom would put the globe under the headline (the
   * "no text on the Earth" rule), so zoom moves between the two fitted levels: pulled far enough
   * in over a continent it drills in, far enough out it returns to the world; otherwise it
   * springs back.
   */
  onStretchRelease(s, at) {
    dirty = true;
    if (s > STRETCH_COMMIT && focus === null) {
      const hit = hitAt(at.x, at.y);
      if (hit) enter(hit.continent);
    } else if (s < -STRETCH_COMMIT && focus !== null) leave();
  },
});

// ---- Dev switcher: preview any theme, or let the demo cycle (buttons in ui/App.svelte) -------
view.autoCycle = source.demo?.autoCycle ?? false;
view.devVisible = config.dev && !config.bench;
view.checkin.visible = !config.bench;
document.body.classList.toggle("dev", view.devVisible);

// ---- Frame loop -------------------------------------------------------------------------------
const probe: FrameProbe = { driving: false, before: null, after: null };
let prevTs = 0;
let perfAt = 0;
let idleRotating = false;
let wasAnimating = false;
/** Whether the globe is still easing to a new layout position (exposed for the layout test). */
let layoutEasing = false;
/** Whether the last frame drew mood-weather particles (off under reduced motion). */
let particlesDrawn = false;

// Day/night band (README §8.2.7, decision M3): real time, refreshed once a minute (the terminator
// moves a quarter of a degree a minute). Bench runs use a fixed sun so frames compare across runs.
const BENCH_SUN_TIME = Date.UTC(2026, 2, 20, 12);
const NIGHT_REFRESH_MS = 60_000;
const showNight = !config.opt.has("nonight");
let sun = subsolarPoint(config.bench ? BENCH_SUN_TIME : Date.now());
let sunAt = performance.now();

function applyTheme(): void {
  const th = mixer.current;
  view.themeId = th.id;
  ui.overlays.scanlines.style.opacity = th.scanlines.toFixed(3);
  ui.overlays.frost.style.opacity = th.frost.toFixed(3);
  ui.overlays.heat.style.opacity = th.heat.toFixed(3);
  document.documentElement.style.setProperty("--accent", th.css.rim);
}

function frame(ts: number): void {
  const t0 = performance.now();
  idleRotating = false;
  const dt = prevTs === 0 ? 0 : Math.min((ts - prevTs) / 1000, 0.05);

  const arrived = source.tick(ts);
  if (arrived !== null) onSnapshot(arrived);

  if (showNight && !config.bench && ts - sunAt > NIGHT_REFRESH_MS) {
    sunAt = ts;
    sun = subsolarPoint(Date.now());
    dirty = true;
  }

  if (probe.driving) {
    probe.before?.(ts);
    dirty = true;
  } else if (camera.update(dt)) {
    dirty = true; // glide, fling or stretch (fixed step, packages/motion)
  } else if (
    !input.dragging &&
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
    applyTheme();
  }

  const anchorEasing = fit.ease(dt);
  layoutEasing = anchorEasing;
  if (anchorEasing) dirty = true;
  applyCamera();
  const moving = probe.driving || input.dragging || camera.moving || idleRotating;
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
  const lod = (lods as Record<LodName, Lod>)[animating ? moveLod : "50m"];
  const tBase = performance.now();
  const drewBase = dirty;
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
        ...(showNight ? { night: sun } : {}),
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
  // Breathing atmosphere (idle life), on the FX layer so the base layer can stay static. A quiet
  // world glows at half strength (decision B4): the signal that nobody is here yet.
  const breath = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(ts / 1400);
  const glow = (headline.quiet ? 0.5 : 1) * (0.28 + 0.12 * breath);
  const halo = fxCtx.createRadialGradient(cx, cy, r * 0.97, cx, cy, r * 1.16);
  halo.addColorStop(0, oklabToCss(mixer.current.lab.rim, glow));
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
  moment.draw(dt);

  const tEnd = performance.now();
  const script = tEnd - t0;
  probe.after?.({
    ts,
    prevTs,
    script,
    base: tFx - tBase,
    fx: tEnd - tFx,
    drewBase,
    lod: lod.name,
    rotating: idleRotating,
  });
  if ((config.debug || config.bench) && ts - perfAt > 500) {
    perfAt = ts;
    perf.textContent = `script ${script.toFixed(2)} ms\nparticles ${config.particles}\nDPR ${dpr.toFixed(2)} (cap ${config.dprCap})\nLOD ${lod.name} · zoom ${camera.view.zoom.toFixed(2)}`;
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
  moment.init(new Map(b.countries.map((f) => [String(f.id), pinPoint(f)])), navigator.languages);
  view.checkin.firstRun = !seen(FLAG_CHECKED_IN);
  refreshJournal();
  // Open facing your pin (decision B2): "you are here" is on screen before any tap, so a wrong
  // guess is obvious. Bench runs keep the fixed start pose so frames compare across runs.
  if (moment.pin !== null && !config.bench) camera.view = { center: moment.pin.lonLat, zoom: 1 };
  centroids = b.countries.map((f) => {
    const [lon, lat] = geoCentroid(f);
    return { code: String(f.id), lon, lat };
  });
  particles = new ParticleField(config.particles, [], rng(42));
  perf.hidden = !(config.debug || config.bench);
  resize();
  layoutReady = true;
  mixer.setTarget(themeFor(snapshot, focus, QUIET_WORLD_BELOW), true);
  onSnapshot(snapshot);
  applyTheme();
  view.status = "ready"; // the header stops saying "loading" only once the first data is in
  window.addEventListener("resize", resize);
  // Any change in the size of text/UI (content, fonts, rotation) re-measures the free area.
  // Fires only on actual size changes, never per frame.
  const ro = new ResizeObserver(refitToCard);
  for (const el of [ui.header, ui.panel, ui.back, ui.dev, ui.checkin]) ro.observe(el);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) prevTs = 0; // don't integrate the time spent hidden
  });
  requestAnimationFrame(frame);
  if (config.bench) {
    // The benchmark harness (verifyRender, run) is its own chunk: never in the normal bundle.
    const { installHarness } = await import("./bench/harness");
    installHarness({
      camera,
      ripples: moment.ripples,
      probe,
      lods: () => lods as Record<LodName, Lod>,
      dpr: () => dpr,
      config,
    });
  }
}

/**
 * Start, and say so if it fails (bridge E4): a map chunk that never arrives (slow data, a bad
 * deploy, a blocker) used to leave a black screen and six disabled faces with no message.
 */
async function boot(): Promise<void> {
  try {
    await start();
  } catch (e) {
    console.error("World Emotion could not start", e);
    view.status = "failed";
  }
}

// ---- Test hooks (always on: e2e and tools/bench read them; src/bench/hooks.ts) -----------------
installTestHooks({
  ready: boot(),
  projection,
  camera,
  ripples: moment.ripples,
  dpr: () => dpr,
  focus: () => focus,
  fitPending: () => fitPending,
  dragging: () => input.dragging,
  particlesDrawn: () => particlesDrawn,
  easing: () => layoutEasing,
  pin: () => moment.pin,
  sun: () => (showNight ? [sun[0], sun[1]] : null),
  worldMood: () => MOODS[snapshot.world.h] ?? "",
  theme: () => MOODS[mixer.target] ?? "",
  aggregate: () => onSnapshot(source.aggregate()),
  face(lon, lat) {
    camera.stop();
    // Hold idle rotation until the next real input: otherwise, under load, the globe turns
    // between a test reading a point's position and its tap landing there.
    lastInput = Number.POSITIVE_INFINITY;
    camera.view = { center: [lon, lat], zoom: camera.view.zoom };
    lastInput = performance.now();
    dirty = true;
  },
});
