import { MOOD_COUNT } from "@world-emotion/shared";
import { geoOrthographic } from "d3-geo";
import type { Config } from "../config";
import type { Camera } from "../engine/camera";
import { CLIP_ANGLE, type Lod, type LodName, pointCount } from "../engine/geo";
import { GlobeLayer } from "../engine/globe-layer";
import { MOOD_COLORS } from "../engine/palette";
import type { Ripples } from "../engine/ripple";
import { FrameRecorder, type FrameSummary } from "../engine/stats";
import type { FrameProbe } from "./probe";

/**
 * Benchmark API for tools/bench, loaded only with ?bench=1 (docs/design/phase-5.5-bridge.md, E1):
 * the render-optimisation self-check and the timed deterministic drag. Nothing here ships in the
 * normal bundle.
 */

export interface HarnessDeps {
  readonly camera: Camera;
  readonly ripples: Ripples;
  readonly probe: FrameProbe;
  lods(): Record<LodName, Lod>;
  dpr(): number;
  readonly config: Config;
}

export interface VerifyVariant {
  cull: boolean;
  precision0: boolean;
  /** Self-test: cull against the wrong view centre. Must report large differences. */
  selfTestWrongCenter?: boolean;
}

export function installHarness(d: HarnessDeps): void {
  /**
   * Deterministic correctness check for render optimisations: draw the same pose twice (reference
   * vs. variant) into offscreen canvases, without particles, and count differing pixels. Culling
   * must give exactly 0 at every pose, because it may only skip features that are not visible.
   */
  async function verifyRender(variant: VerifyVariant) {
    const lods = d.lods();
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
        .clipAngle(CLIP_ANGLE)
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
          ref.layer.draw(lods[res], fixedColor, 0, null, {
            cull: false,
            borders: true,
            viewCenter,
          });
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
    return {
      poses,
      worstPx: worst.px,
      worstRotate: worst.rotate,
      worstByLod,
      totalPx: size * size,
    };
  }

  async function run() {
    const { probe, camera, config } = d;
    // Idle probe: 2 s with nothing moving shows the frame rate Chrome actually gives this page.
    const idle: number[] = [];
    const idleFrames: { script: number; base: boolean; lod: string; rotating: boolean }[] = [];
    probe.after = (s) => {
      if (s.prevTs === 0) return;
      idle.push(s.ts - s.prevTs);
      idleFrames.push({ script: s.script, base: s.drewBase, lod: s.lod, rotating: s.rotating });
    };
    await new Promise((r) => setTimeout(r, 2000));
    probe.after = null;
    const samples = idle.sort((a, b) => a - b);
    const idleIntervalP50 = samples[Math.floor(samples.length / 2)] ?? Number.NaN;

    const recorder = new FrameRecorder(Math.ceil((config.benchSeconds + 2) * 150));
    const summary = await new Promise<FrameSummary>((resolve) => {
      const start = performance.now();
      // Deterministic "drag": constant spin plus a wobble, identical on every run.
      probe.before = (ts) => {
        const t = (ts - start) / 1000;
        camera.view = { center: [10 - 90 * t, 20 - 15 * Math.sin(t * 1.3)], zoom: 1 };
        if (config.benchRipple && !d.ripples.active)
          d.ripples.add([8, 9.6], MOOD_COLORS[0] ?? "#fff");
      };
      probe.after = (s) => {
        if (s.prevTs === 0) return;
        const elapsed = (s.ts - start) / 1000;
        if (elapsed > 1) recorder.push(s.ts - s.prevTs, s.script, s.base, s.fx); // skip 1 s warm-up
        if (elapsed > config.benchSeconds + 1) {
          probe.driving = false;
          probe.before = null;
          probe.after = null;
          resolve(recorder.summary(1000 / config.expectedHz));
        }
      };
      probe.driving = true;
    });

    const n = idleFrames.length;
    const idleDetail = {
      frames: n,
      scriptP50:
        [...idleFrames].map((f) => f.script).sort((a, b) => a - b)[Math.floor(n / 2)] ?? Number.NaN,
      baseRedraws: idleFrames.filter((f) => f.base).length,
      lods: [...new Set(idleFrames.map((f) => f.lod))],
      rotatingFrames: idleFrames.filter((f) => f.rotating).length,
    };
    const lods = d.lods();
    return {
      ...summary,
      config: { ...config, opt: [...config.opt] },
      points: { move: pointCount(lods.move), "110m": pointCount(lods["110m"]) },
      dpr: d.dpr(),
      idleIntervalP50,
      idleDetail,
    };
  }

  if (!window.__bench) throw new Error("test hooks must be installed before the harness");
  window.__bench.verifyRender = verifyRender;
  window.__bench.run = run;
}
