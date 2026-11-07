import { MOOD_COUNT } from "@world-emotion/shared";

/**
 * Mood hues, indexed by MoodId (happy, calm, excited, stressed, sad, angry). Constant across
 * themes so a colour never changes meaning; moods are also always named in the UI.
 */
export const MOOD_COLORS: readonly string[] = [
  "#f2c14e",
  "#7fc8a9",
  "#ff7a59",
  "#b07cc6",
  "#6f8fd8",
  "#e4572e",
];
if (MOOD_COLORS.length !== MOOD_COUNT) throw new Error("palette must cover every mood");

/** Kept for the benchmark/verification path, which renders a fixed reference style. */
export const PAPER = "#f3ead8";
export const OCEAN = "#e9dcc0";
export const NEUTRAL_LAND = "#d9c9a6";
export const BORDER = "rgba(70, 50, 30, 0.35)";
export const SPHERE_EDGE = "rgba(70, 50, 30, 0.5)";
