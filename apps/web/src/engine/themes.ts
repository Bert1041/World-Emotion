import type { MoodId } from "@world-emotion/shared";
import { easeInOutCubic, hexToOklab, mixOklab, type Oklab, oklabToCss } from "./color";

/** One Earth per world mood (docs/design/phase-3b-look-and-feel.md). Pure data: retune freely. */
interface ThemeDef {
  readonly name: string;
  readonly skyInner: string;
  readonly skyOuter: string;
  readonly ocean: string;
  readonly land: string;
  readonly border: string;
  readonly rim: string;
  /** CSS overlay strengths, 0–1. */
  readonly scanlines: number;
  readonly frost: number;
  readonly heat: number;
}

export const THEMES: Readonly<Record<MoodId, ThemeDef>> = {
  0: {
    name: "Overgrown Earth",
    skyInner: "#14382b",
    skyOuter: "#04110c",
    ocean: "#0f4c5c",
    land: "#2f6b3a",
    border: "#0a2a1a",
    rim: "#9be37a",
    scanlines: 0,
    frost: 0,
    heat: 0,
  },
  1: {
    name: "Waterworld",
    skyInner: "#0c2c40",
    skyOuter: "#03101a",
    ocean: "#1b6d8a",
    land: "#3d7c84",
    border: "#0d3b4a",
    rim: "#7fd6e0",
    scanlines: 0,
    frost: 0,
    heat: 0,
  },
  2: {
    name: "City-lights Earth",
    skyInner: "#1d1133",
    skyOuter: "#06030d",
    ocean: "#0d0b24",
    land: "#2a2340",
    border: "#6a55a8",
    rim: "#ff7ad9",
    scanlines: 0,
    frost: 0,
    heat: 0,
  },
  3: {
    name: "Simulation Earth",
    skyInner: "#07150d",
    skyOuter: "#010402",
    ocean: "#031a10",
    land: "#0b2e1c",
    border: "#3dff8a",
    rim: "#3dff8a",
    scanlines: 1,
    frost: 0,
    heat: 0,
  },
  4: {
    name: "Ice-age Earth",
    skyInner: "#1e2c40",
    skyOuter: "#090f17",
    ocean: "#4a6a85",
    land: "#c9d6e3",
    border: "#7f93a8",
    rim: "#b8d4f0",
    scanlines: 0,
    frost: 1,
    heat: 0,
  },
  5: {
    name: "Ruined Earth",
    skyInner: "#2c1009",
    skyOuter: "#0c0402",
    ocean: "#2b1a14",
    land: "#4a3326",
    border: "#1a0c07",
    rim: "#ff6a2a",
    scanlines: 0,
    frost: 0,
    heat: 1,
  },
};

type ColorKey = "skyInner" | "skyOuter" | "ocean" | "land" | "border" | "rim";
const COLOR_KEYS: readonly ColorKey[] = ["skyInner", "skyOuter", "ocean", "land", "border", "rim"];

export interface ResolvedTheme {
  readonly name: string;
  readonly lab: Readonly<Record<ColorKey, Oklab>>;
  readonly css: Readonly<Record<ColorKey, string>>;
  readonly scanlines: number;
  readonly frost: number;
  readonly heat: number;
}

const resolve = (d: ThemeDef): Omit<ResolvedTheme, "css"> => ({
  name: d.name,
  lab: Object.fromEntries(COLOR_KEYS.map((k) => [k, hexToOklab(d[k])])) as Record<ColorKey, Oklab>,
  scanlines: d.scanlines,
  frost: d.frost,
  heat: d.heat,
});

/** Cross-fades between themes in OKLab over `durationS`. `update` returns true while changing. */
export class ThemeMixer {
  private from: Omit<ResolvedTheme, "css">;
  private to: Omit<ResolvedTheme, "css">;
  private t = 1;
  private cached: ResolvedTheme;
  target: MoodId;

  constructor(
    mood: MoodId,
    private readonly durationS = 2.5,
  ) {
    this.target = mood;
    this.from = resolve(THEMES[mood]);
    this.to = this.from;
    this.cached = this.compute();
  }

  setTarget(mood: MoodId, instant = false): void {
    if (mood === this.target && !instant) return;
    this.from = this.compute();
    this.to = resolve(THEMES[mood]);
    this.target = mood;
    this.t = instant ? 1 : 0;
    this.cached = this.compute();
  }

  get current(): ResolvedTheme {
    return this.cached;
  }

  update(dt: number): boolean {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.durationS);
    this.cached = this.compute();
    return true;
  }

  private compute(): ResolvedTheme {
    const k = easeInOutCubic(this.t);
    const lab = Object.fromEntries(
      COLOR_KEYS.map((c) => [c, mixOklab(this.from.lab[c], this.to.lab[c], k)]),
    ) as Record<ColorKey, Oklab>;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    return {
      name: k < 0.5 ? this.from.name : this.to.name,
      lab,
      css: Object.fromEntries(COLOR_KEYS.map((c) => [c, oklabToCss(lab[c])])) as Record<
        ColorKey,
        string
      >,
      scanlines: lerp(this.from.scanlines, this.to.scanlines),
      frost: lerp(this.from.frost, this.to.frost),
      heat: lerp(this.from.heat, this.to.heat),
    };
  }
}
