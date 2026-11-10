import type { Continent, MoodId } from "@world-emotion/shared";

/**
 * Everything the DOM UI shows (README §8.1 layer 4). The engine (main.ts) writes here; Svelte
 * renders it. The canvases, theme overlays and per-frame perf readout are not UI and stay outside.
 * The engine writes meaning (ids, numbers), never words: the UI puts them into the active
 * language (src/i18n), so switching language needs nothing from the engine.
 */
export interface Bar {
  readonly mood: MoodId;
  /** 0..1 */
  readonly share: number;
  readonly pct: number;
  readonly color: string;
  readonly lead: boolean;
}

export type Place =
  | { readonly kind: "continent"; readonly id: Continent }
  | { readonly kind: "country"; readonly code: string };

/** The card's last line: no data, quiet (few votes), quiet with the continent shown, or a count. */
export type PanelStatus =
  | { readonly kind: "none" }
  | { readonly kind: "quiet" }
  | { readonly kind: "quietShowing"; readonly continent: Continent }
  | { readonly kind: "count"; readonly n: number };

export interface PanelView {
  readonly place: Place;
  /** Leading mood, or null when quiet / no data (then no "feels …" line). */
  readonly mood: { readonly id: MoodId; readonly color: string } | null;
  readonly status: PanelStatus;
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
  /**
   * Start-up: the map is loading, loaded, or failed to load (bridge E4). The header says which;
   * nothing else on screen pretends to have data before "ready".
   */
  status: "loading" as "loading" | "ready" | "failed",
  /** Headline mood, or null while the world is quiet (below the privacy floor, ADR 0003). */
  worldMood: null as MoodId | null,
  /** The world has too few check-ins for a headline: "The world is quiet", count "so far". */
  worldQuiet: false,
  /** Bumped to replay the headline word's entrance (a change of mood, or coming back out). */
  worldSwap: 0,
  themeId: null as MoodId | null,
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
    /** Every pickable country code; names come from the active language (i18n.country). */
    countries: [] as readonly string[],
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
