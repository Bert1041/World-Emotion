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
  /** Demo data: ?votes=N gives a world of exactly N check-ins (tests: the quiet state). */
  readonly votes: number | undefined;
  /**
   * Demo data: one aggregation run every ?step= ms (default 2000). Tests set it very long so that
   * only the snapshots they force happen (a run of its own made the tween tests racy on CI).
   */
  readonly demoStepMs: number;
  /** Real data (Phase 6): where to poll the snapshot and send check-ins; null means the demo. */
  readonly live: LiveEndpoints | null;
  /**
   * Phase 6.5 prototype (docs/design/phase-6.5-motion-sound.md, D1): `?look=next` shows the new
   * motion and the sound button; anything else is today's app. Bench runs may compare both.
   */
  readonly look: "now" | "next";
}

export interface LiveEndpoints {
  readonly snapshotUrl: string;
  readonly apiUrl: string;
}

export interface ConfigContext {
  /** The page's own host name. */
  readonly host: string;
  /** Build-time endpoints (Vite env), set at deploy (docs/design/phase-6-live-data.md, L1). */
  readonly env: {
    readonly VITE_SNAPSHOT_URL?: string;
    readonly VITE_API_URL?: string;
    readonly VITE_LOOK?: string;
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Which data to show. `?demo=1` and bench runs: the demo. `?live=<api origin>`: a local API, but
 * only for a page served from this machine, so nobody can send a link to the real site that shows
 * a made-up world. Otherwise the build's endpoints, if it has them; else the demo.
 */
function liveEndpoints(
  params: URLSearchParams,
  bench: boolean,
  ctx: ConfigContext,
): LiveEndpoints | null {
  if (bench || params.get("demo") === "1") return null;
  const local = params.get("live");
  if (local !== null && LOCAL_HOSTS.has(ctx.host)) {
    try {
      const u = new URL(local);
      if (LOCAL_HOSTS.has(u.hostname))
        return { snapshotUrl: `${u.origin}/snapshot.json`, apiUrl: u.origin };
    } catch {
      // not a URL: fall through
    }
  }
  const { VITE_SNAPSHOT_URL: s, VITE_API_URL: a } = ctx.env;
  return s && a ? { snapshotUrl: s, apiUrl: a } : null;
}

export function readConfig(
  params: URLSearchParams,
  ctx: ConfigContext = { host: "", env: {} },
): Config {
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
    votes:
      params.has("votes") && Number.isInteger(num("votes", -1)) && num("votes", -1) >= 0
        ? num("votes", 0)
        : undefined,
    demoStepMs: Math.max(100, num("step", 2000)),
    live: liveEndpoints(params, bench, ctx),
    // The URL wins; a build may set the default (VITE_LOOK=next runs the whole suite in the new look).
    look: (params.get("look") ?? ctx.env.VITE_LOOK) === "next" ? "next" : "now",
  };
}
