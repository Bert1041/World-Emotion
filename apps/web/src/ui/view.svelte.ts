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

export interface Flight {
  readonly id: number;
  readonly mood: MoodId;
  /** CSS px: the face button it leaves from, and where your country will be when it lands. */
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
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
  /** Active check-ins in the world snapshot; ticks up when yours lands. */
  worldCount: 0,
  checkin: {
    /** World view only: the bottom bar, like the card in a region. */
    visible: false,
    country: null as string | null,
    countries: [] as { readonly code: string; readonly name: string }[],
    /** Your active mood this session, or null before you check in. */
    mine: null as MoodId | null,
    /** Pick mode: the globe is the country picker ("tap where you are"). */
    picking: false,
  },
  flight: null as Flight | null,
});

export interface UiActions {
  back(): void;
  previewMood(m: MoodId): void;
  toggleAuto(): void;
  /** You picked a mood; `from` is the centre of the face you tapped (CSS px). */
  checkIn(mood: MoodId, from: { x: number; y: number }): void;
  /** Chosen from the search (the globe tap path goes through the engine's hit test). */
  setCountry(code: string): void;
  startPick(): void;
  cancelPick(): void;
  /** The flying face reached your country (flight `id`). */
  landed(id: number): void;
  /** The region card finished moving (peek ↔ open): re-measure and re-fit the map. */
  cardMoved(): void;
}
