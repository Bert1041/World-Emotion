import type { MoodId } from "@world-emotion/shared";
import { at, type Dist, EPSILON, leader } from "./dist";

export interface HeadlineState {
  readonly headline: MoodId;
  /** The mood currently out-polling the headline without having flipped it yet. */
  readonly challenger: MoodId | null;
  /** Consecutive snapshots the *same* challenger has led. */
  readonly streak: number;
}

export interface HysteresisConfig {
  readonly margin: number;
  readonly streak: number;
}

/**
 * Headline with hysteresis (README §5.5): the headline flips only when the new leader is ahead
 * by `margin`, or has led for `streak` consecutive snapshots. See design doc §3 for the rules.
 */
export function nextHeadline(
  dist: Dist,
  prev: HeadlineState | undefined,
  cfg: HysteresisConfig,
): HeadlineState {
  const lead = leader(dist, prev?.headline);
  const settled = (headline: MoodId): HeadlineState => ({ headline, challenger: null, streak: 0 });

  if (prev === undefined || lead === prev.headline) return settled(lead);
  if (at(dist, lead) - at(dist, prev.headline) >= cfg.margin - EPSILON) return settled(lead);

  const streak = prev.challenger === lead ? prev.streak + 1 : 1;
  if (streak >= cfg.streak) return settled(lead);
  return { headline: prev.headline, challenger: lead, streak };
}
