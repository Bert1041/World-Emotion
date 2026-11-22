import { buildSnapshot, type VoteCount } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import {
  type AggregatorState,
  type Continent,
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
/** Each demo continent's own leaning, so all six Earths can be visited by zooming (bridge T1). */
export const CONTINENT_LEAN: Readonly<Record<Continent, MoodId>> = {
  AF: 0, // happy
  NA: 1, // calm
  AS: 2, // excited
  EU: 3, // stressed
  OC: 4, // sad
  SA: 5, // angry
  AN: 1,
};

export class SnapshotSim {
  private state: AggregatorState | undefined;
  private simTime = 1_700_000_000;
  private readonly home = new Map<string, { mood: number; n: number }>();
  snapshot: Snapshot;
  bias: MoodId;
  /** This device's active check-in (README §5.2: one per device; a new one replaces it). */
  private mine: { country: string; mood: MoodId } | null = null;

  /** Fixed-votes mode (tests): counts go in as they are, not through the demo's mood weighting. */
  private readonly fixed: boolean;

  /**
   * `votes`: instead of a full world, exactly this many check-ins, all in the first country of the
   * map and all for the bias mood (tests: a quiet world below the privacy floor at 4, that country
   * published at 5). `undefined` is the full demo world.
   */
  constructor(bias: MoodId, opts: { readonly votes?: number } = {}) {
    this.bias = bias;
    this.fixed = opts.votes !== undefined;
    const r = rng(7);
    let left = opts.votes;
    for (const code of COUNTRY_TO_CONTINENT.keys()) {
      if (left !== undefined) {
        this.home.set(code, { mood: bias, n: left });
        left = 0;
        continue;
      }
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
      if (this.fixed) {
        if (n > 0) counts.push({ country, mood, n });
        continue;
      }
      const lean = CONTINENT_LEAN[COUNTRY_TO_CONTINENT.get(country) as Continent];
      for (let m = 0; m < MOOD_COUNT; m++) {
        // World bias of 2 (not more): the world headline follows the bias, but countries whose
        // home mood differs keep their own colour, so the map stays varied like real data. Each
        // continent leans its own way by 3, so its headline (and its Earth, bridge T1) differs
        // from the world's: the leans cancel out across continents, the bias does not.
        const w = (m === mood ? 3 : 1) + (m === this.bias ? 2 : 0) + (m === lean ? 3 : 0);
        const c = Math.round((n * w) / (MOOD_COUNT + 2 + 2 + 3));
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
