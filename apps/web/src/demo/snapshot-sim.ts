import { buildSnapshot, type VoteCount } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import {
  type AggregatorState,
  MOOD_COUNT,
  type MoodId,
  type Snapshot,
} from "@world-emotion/shared";
import { rng } from "../engine/particles";

/**
 * Demo data through the REAL pipeline (Phase 1's buildSnapshot): synthetic votes go in, and the
 * smoothing, shrinkage, privacy floor and headline hysteresis all behave as in production. A
 * "world bias" mood rotates over time so the world headline, and therefore the theme, changes.
 */
export class SnapshotSim {
  private state: AggregatorState | undefined;
  private simTime = 1_700_000_000;
  private readonly home = new Map<string, { mood: number; n: number }>();
  snapshot: Snapshot;
  bias: MoodId;
  /** This device's active check-in (README §5.2: one per device; a new one replaces it). */
  private mine: { country: string; mood: MoodId } | null = null;

  constructor(bias: MoodId) {
    this.bias = bias;
    const r = rng(7);
    for (const code of COUNTRY_TO_CONTINENT.keys()) {
      // Skewed sizes: many small countries (some below the privacy floor), a few big ones.
      this.home.set(code, { mood: Math.floor(r() * MOOD_COUNT), n: Math.floor(r() ** 3 * 400) });
    }
    this.snapshot = this.step();
  }

  /** Your check-in, counted from the next aggregation run on (as the real aggregator would). */
  checkIn(country: string, mood: MoodId): void {
    if (!COUNTRY_TO_CONTINENT.has(country)) throw new Error(`unknown country ${country}`);
    this.mine = { country, mood };
  }

  /** One aggregation run, 5 simulated minutes after the previous one. */
  step(): Snapshot {
    const counts: VoteCount[] = [];
    for (const [country, { mood, n }] of this.home) {
      for (let m = 0; m < MOOD_COUNT; m++) {
        // Bias of 2 (not more): the world headline follows the bias, but countries whose home
        // mood differs keep their own colour, so the map stays varied like real data.
        const w = (m === mood ? 3 : 1) + (m === this.bias ? 2 : 0);
        const c = Math.round((n * w) / (MOOD_COUNT + 2 + 2));
        if (c > 0) counts.push({ country, mood: m, n: c });
      }
    }
    if (this.mine) counts.push({ country: this.mine.country, mood: this.mine.mood, n: 1 });
    this.simTime += 300;
    const out = buildSnapshot({
      counts,
      countryToContinent: COUNTRY_TO_CONTINENT,
      now: this.simTime,
      previousState: this.state,
    });
    this.state = out.state;
    this.snapshot = out.snapshot;
    return out.snapshot;
  }
}
