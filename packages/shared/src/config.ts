/**
 * Every tunable in one place (README §8.3 spirit, applied to data). Values are starting points,
 * retuned with the traffic simulator in Phases 5–6. See docs/design/phase-1-core.md §2.
 */
export interface AggregationConfig {
  /** How long a check-in counts. */
  readonly windowSeconds: number;
  /** Shrinkage strength per level: how many "virtual votes" the parent contributes. */
  readonly shrinkK: {
    readonly country: number;
    readonly continent: number;
    readonly world: number;
  };
  /** Temporal smoothing half-life. Cadence-independent by construction. */
  readonly smoothingHalfLifeSeconds: number;
  /** A challenger this far ahead of the current headline flips it immediately. */
  readonly hysteresisMargin: number;
  /** ...or after leading for this many consecutive snapshots. */
  readonly hysteresisStreak: number;
  /**
   * Privacy floor: countries and continents with fewer raw votes are omitted from the public
   * snapshot (decision P2a), so a single voter's mood cannot be read back out of it.
   */
  readonly publishMinN: number;
  /** Decimal places for published distributions. */
  readonly distDecimals: number;
}

export const DEFAULT_CONFIG: AggregationConfig = {
  windowSeconds: 6 * 60 * 60,
  shrinkK: { country: 15, continent: 15, world: 15 },
  smoothingHalfLifeSeconds: 180,
  hysteresisMargin: 0.03,
  hysteresisStreak: 2,
  publishMinN: 5,
  distDecimals: 4,
};
