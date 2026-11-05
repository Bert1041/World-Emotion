import {
  AGGREGATOR_STATE_VERSION,
  type AggregationConfig,
  type AggregatorState,
  CONTINENTS,
  type Continent,
  DEFAULT_CONFIG,
  SNAPSHOT_VERSION,
  type Snapshot,
  type SnapshotRegion,
  type StateRegion,
} from "@world-emotion/shared";
import { type Counts, type Dist, total, uniform, zeros } from "./dist";
import { nextHeadline } from "./hysteresis";
import { type CountryToContinent, poolCounts, type VoteCount } from "./pool";
import { shrink } from "./shrink";
import { blend, smoothingAlpha } from "./smooth";
import { publishable } from "./suppress";

export interface BuildInput {
  /** Active-window vote counts, as returned by the aggregator's GROUP BY query. */
  readonly counts: readonly VoteCount[];
  readonly countryToContinent: CountryToContinent;
  /** Unix seconds. Passed in: core never reads the clock. */
  readonly now: number;
  /** Private state from the previous run, if any. */
  readonly previousState?: AggregatorState | undefined;
  readonly config?: AggregationConfig;
}

export interface BuildOutput {
  /** Public: written to R2 and served to every client. */
  readonly snapshot: Snapshot;
  /** Private: written back to R2 for the next run. Never published. */
  readonly state: AggregatorState;
}

/**
 * The whole aggregation step as one pure function (design doc §3, "Pipeline"):
 * pool → shrink (world → continent → country) → smooth → hysteresis → publish (floor + round).
 */
export function buildSnapshot(input: BuildInput): BuildOutput {
  const config = input.config ?? DEFAULT_CONFIG;
  const state = nextState(input, config);
  return { snapshot: renderSnapshot(state, input.countryToContinent, config), state };
}

export function nextState(input: BuildInput, config: AggregationConfig): AggregatorState {
  const { now, previousState: prev } = input;

  // A duplicate or clock-skewed run must not move anything (design doc §3, Smoothing).
  if (prev !== undefined && now <= prev.generatedAt) return prev;

  const alpha =
    prev === undefined
      ? 1
      : smoothingAlpha(now - prev.generatedAt, config.smoothingHalfLifeSeconds);
  const step = (counts: Counts, shrunk: Dist, before: StateRegion | undefined): StateRegion => {
    const dist = before === undefined ? [...shrunk] : blend(shrunk, before.dist, alpha);
    const h = nextHeadline(dist, before, {
      margin: config.hysteresisMargin,
      streak: config.hysteresisStreak,
    });
    return { n: total(counts), dist, ...h };
  };

  const pooled = poolCounts(input.counts, input.countryToContinent);
  const k = config.shrinkK;

  // Shrink the whole tree first (each level leans on its shrunk, *unsmoothed* parent), then
  // smooth each node independently against its own previous value.
  const worldShrunk = shrink(pooled.world, uniform(), k.world);
  const world = step(pooled.world, worldShrunk, prev?.world);

  const continentShrunk = new Map<Continent, number[]>();
  const continents: Partial<Record<Continent, StateRegion>> = {};
  for (const c of CONTINENTS) {
    const counts = pooled.continents.get(c) ?? zeros();
    const shrunk = shrink(counts, worldShrunk, k.continent);
    continentShrunk.set(c, shrunk);
    continents[c] = step(counts, shrunk, prev?.continents[c]);
  }

  // Countries: everything with votes now, plus everything we have history for (so a country
  // whose votes expire fades back toward its continent instead of vanishing). Bounded by the
  // size of the country map. A country no longer in the map is dropped.
  const codes = new Set<string>(pooled.countries.keys());
  for (const code of Object.keys(prev?.countries ?? {})) codes.add(code);

  const countries: Record<string, StateRegion> = {};
  for (const code of [...codes].sort()) {
    const continent = input.countryToContinent.get(code);
    if (continent === undefined) continue;
    const parent = continentShrunk.get(continent);
    if (parent === undefined) throw new Error(`unknown continent ${continent} for ${code}`);
    const counts = pooled.countries.get(code) ?? zeros();
    countries[code] = step(counts, shrink(counts, parent, k.country), prev?.countries[code]);
  }

  return { v: AGGREGATOR_STATE_VERSION, generatedAt: now, world, continents, countries };
}

/**
 * Public view of the state. Privacy (ADR 0003): regions below the floor are omitted (P2a), and
 * complementary suppression keeps every hidden remainder at 0 or >= floor (P3 = A), both for
 * countries within each continent and for continents within the world. The world is always
 * published. Distributions are rounded. Key order is deterministic, so the same state always
 * serialises to byte-identical JSON.
 */
export function renderSnapshot(
  state: AggregatorState,
  countryToContinent: CountryToContinent,
  config: AggregationConfig,
): Snapshot {
  const publish = (r: StateRegion): SnapshotRegion => ({
    n: r.n,
    dist: r.dist.map((p) => round(p, config.distDecimals)),
    h: r.headline,
  });

  const floor = config.publishMinN;

  // Continents within the world. The world's remainder also holds unknown-country votes.
  const continentRows = CONTINENTS.map((c) => [c, state.continents[c]?.n ?? 0] as const);
  const safeContinents = publishable(state.world.n, continentRows, floor);
  const continents: Partial<Record<Continent, SnapshotRegion>> = {};
  for (const c of CONTINENTS) {
    const r = state.continents[c];
    if (r !== undefined && safeContinents.has(c)) continents[c] = publish(r);
  }

  // Countries within each continent, whether or not the continent itself is published: a
  // hidden continent's counts may still be derivable from the world, so its own remainder
  // must be safe too.
  const byContinent = new Map<Continent, [string, number][]>();
  for (const [code, r] of Object.entries(state.countries)) {
    const c = countryToContinent.get(code);
    if (c === undefined) continue; // not in the map: never published
    const list = byContinent.get(c) ?? [];
    list.push([code, r.n]);
    byContinent.set(c, list);
  }
  const safeCountries = new Set<string>();
  for (const [c, list] of byContinent) {
    for (const code of publishable(state.continents[c]?.n ?? 0, list, floor))
      safeCountries.add(code);
  }
  const countries: Record<string, SnapshotRegion> = {};
  for (const code of Object.keys(state.countries).sort()) {
    const r = state.countries[code];
    if (r !== undefined && safeCountries.has(code)) countries[code] = publish(r);
  }

  return {
    v: SNAPSHOT_VERSION,
    generatedAt: state.generatedAt,
    windowSeconds: config.windowSeconds,
    world: publish(state.world),
    continents,
    countries,
  };
}

function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
