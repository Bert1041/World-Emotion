import type { MoodId } from "@world-emotion/shared";

/**
 * Everything the DOM UI shows (README §8.1 layer 4). The engine (main.ts) writes here; Svelte
 * renders it. The canvases, theme overlays and per-frame perf readout are not UI and stay outside.
 */
export interface Bar {
  readonly name: string;
  /** 0..1 */
  readonly share: number;
  readonly pct: number;
  readonly color: string;
  readonly lead: boolean;
}

export interface PanelView {
  readonly title: string;
  /** Leading mood, or null when quiet / no data (then no "feels …" line). */
  readonly mood: { readonly id: MoodId; readonly name: string; readonly color: string } | null;
  readonly sub: string;
  readonly bars: readonly Bar[];
}

export const view = $state({
  worldMood: "",
  /** Bumped to replay the headline word's entrance (a change of mood, or coming back out). */
  worldSwap: 0,
  themeName: "",
  zoomed: false,
  panel: null as PanelView | null,
  devVisible: false,
  autoCycle: true,
});

export interface UiActions {
  back(): void;
  previewMood(m: MoodId): void;
  toggleAuto(): void;
  /** The region card finished moving (peek ↔ open): re-measure and re-fit the map. */
  cardMoved(): void;
}
