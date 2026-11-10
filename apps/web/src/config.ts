import type { LodName } from "./engine/geo";

/** URL-parameter configuration; the bench runner sweeps scenarios with ?bench=1 (tools/bench). */
export interface Config {
  readonly bench: boolean;
  readonly particles: number;
  /** Map drawn on animation frames; "move" unless a bench scenario compares another. */
  readonly dragLod: LodName;
  /** Share of the 110m points the moving map keeps (tuned on the Pixel, docs/bench). */
  readonly moveKeep: number;
  readonly dprCap: number;
  readonly benchSeconds: number;
  readonly expectedHz: number;
  /** Render optimisations (pixel-identical on 110m/50m; ≤0.06% of pixels on the moving map, see
   * bench/harness verifyRender): on unless switched off. */
  readonly opt: ReadonlySet<string>;
  readonly debug: boolean;
  /** Bench only: keep a check-in ripple on the globe for the whole run (tools/bench phase4). */
  readonly benchRipple: boolean;
  /** Prototype theme switcher (bottom bar); off by default now the check-in owns the bottom. */
  readonly dev: boolean;
  /** Demo data: the world's mood rotates on its own unless ?auto=0 (never in a bench run). */
  readonly autoCycle: boolean;
}

export function readConfig(params: URLSearchParams): Config {
  const num = (k: string, d: number) => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && params.has(k) ? v : d;
  };
  const bench = params.get("bench") === "1";
  return {
    bench,
    particles: num("particles", 700),
    dragLod: (["110m", "50m"].includes(params.get("dragLod") ?? "")
      ? params.get("dragLod")
      : "move") as LodName,
    moveKeep: num("moveKeep", 0.25),
    dprCap: num("dpr", 2),
    benchSeconds: num("seconds", 10),
    expectedHz: num("hz", 60),
    opt: new Set((params.get("opt") ?? "precision0,cull").split(",").filter(Boolean)),
    debug: params.get("debug") === "1",
    benchRipple: params.get("ripple") === "1",
    dev: params.get("dev") === "1",
    autoCycle: !bench && params.get("auto") !== "0",
  };
}
