/**
 * One definition of each layout breakpoint. index.html's CSS repeats the strings (it cannot import);
 * breakpoints.test.ts fails if the two drift apart (docs/design/phase-5.5-bridge.md, E6).
 */

/** Landscape-shaped screens get a side card; portrait ones a bottom sheet. */
export const SIDE_CARD_QUERY = "(min-aspect-ratio: 6/5)";
/** A phone on its side docks the check-in panel to the right. */
export const DOCK_RIGHT_QUERY = "(min-aspect-ratio: 6/5) and (max-height: 520px)";
/** Wide enough (and not a phone on its side): the check-in bar is one slim row. */
export const SLIM_BAR_QUERY = "(min-width: 720px) and (min-height: 521px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Every query the page uses, so a new one in the CSS must be added here too. */
export const ALL_QUERIES: readonly string[] = [
  SIDE_CARD_QUERY,
  DOCK_RIGHT_QUERY,
  SLIM_BAR_QUERY,
  REDUCED_MOTION_QUERY,
];
