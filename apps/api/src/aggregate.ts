/**
 * The aggregator: the I/O around `core.buildSnapshot` (docs/design/phase-6-live-data.md §2).
 * Runs from the Worker's cron every 5 minutes. Pure maths lives in core; this file only reads the
 * window from D1 and the previous state from R2, and writes the results back.
 */
import { buildSnapshot, type VoteCount, windowBounds } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import {
  type AggregationConfig,
  type AggregatorState,
  DEFAULT_CONFIG,
  parseAggregatorState,
} from "@world-emotion/shared";
import { purgeExpired } from "./db";

/** R2 keys. The state is private: never served, never linked. */
export const SNAPSHOT_KEY = "snapshot.json";
export const STATE_KEY = "aggregator-state.json";
export const archiveKey = (nowSeconds: number) => {
  const d = new Date(nowSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `archive/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${p(d.getUTCHours())}.json`;
};

/** Clients poll every 45 s ± 15 s (L4); 30 s at the CDN keeps a new snapshot within ~1.5 min. */
export const SNAPSHOT_CACHE_CONTROL = "public, max-age=30";

/**
 * The window, grouped as `core.poolCounts` wants it. Reads `idx_votes_window` in order (~1 row
 * read per vote, measured in Phase 5). A NULL country (world only) becomes "", which no country
 * map contains, so it counts toward the world alone.
 */
export const WINDOW_SQL = `
SELECT COALESCE(country, '') AS country, mood, COUNT(*) AS n
FROM votes WHERE created_at > ?1 AND created_at <= ?2
GROUP BY country, mood`;

export interface AggregationEnv {
  DB: D1Database;
  SNAPSHOTS: R2Bucket;
}

export interface RunReport {
  /** False when the run changed nothing (a duplicate or early run). */
  readonly wrote: boolean;
  readonly rowsRead: number;
  readonly worldN: number;
  /** The previous state was missing or unreadable, so this run started fresh. */
  readonly freshState: boolean;
  /** Why an existing state was unreadable (logged: smoothing and hysteresis restart). */
  readonly stateProblem: string | null;
  readonly archived: string | null;
  readonly purged: { deleted: number; rowsRead: number; rowsWritten: number } | null;
}

const hour = (s: number) => Math.floor(s / 3600);

export async function runAggregation(
  env: AggregationEnv,
  nowSeconds: number,
  config: AggregationConfig = DEFAULT_CONFIG,
): Promise<RunReport> {
  const { after, until } = windowBounds(nowSeconds, config.windowSeconds);
  const q = await env.DB.prepare(WINDOW_SQL).bind(after, until).all<VoteCount>();
  const counts = q.results;

  const previous = await readState(env.SNAPSHOTS);
  const { snapshot, state } = buildSnapshot({
    counts,
    countryToContinent: COUNTRY_TO_CONTINENT,
    now: nowSeconds,
    previousState: previous.state,
    config,
  });

  // `nextState` returns the previous state untouched for a run at or before its time.
  if (previous.state !== undefined && state === previous.state)
    return {
      wrote: false,
      rowsRead: q.meta.rows_read,
      worldN: state.world.n,
      freshState: false,
      stateProblem: null,
      archived: null,
      purged: null,
    };

  // State first: if the snapshot write then fails, the next run rebuilds it from this state.
  // The other order could publish numbers the next run's smoothing never saw.
  await env.SNAPSHOTS.put(STATE_KEY, JSON.stringify(state), {
    httpMetadata: { contentType: "application/json" },
  });
  const body = JSON.stringify(snapshot);
  await env.SNAPSHOTS.put(SNAPSHOT_KEY, body, {
    httpMetadata: { contentType: "application/json", cacheControl: SNAPSHOT_CACHE_CONTROL },
  });

  // Once an hour (the first run in a new hour): archive the published snapshot (ADR 0007; it is
  // public already, so it holds published regions only) and purge expired votes (the purge scans
  // every row, so not every 5 minutes).
  const newHour =
    previous.state === undefined || hour(nowSeconds) > hour(previous.state.generatedAt);
  let archived: string | null = null;
  let purged: RunReport["purged"] = null;
  if (newHour) {
    archived = archiveKey(nowSeconds);
    await env.SNAPSHOTS.put(archived, body, { httpMetadata: { contentType: "application/json" } });
    purged = await purgeExpired(env.DB, nowSeconds, config.windowSeconds);
  }

  return {
    wrote: true,
    rowsRead: q.meta.rows_read,
    worldN: snapshot.world.n,
    freshState: previous.state === undefined,
    stateProblem: previous.problem,
    archived,
    purged,
  };
}

async function readState(
  bucket: R2Bucket,
): Promise<{ state: AggregatorState | undefined; problem: string | null }> {
  const obj = await bucket.get(STATE_KEY);
  if (obj === null) return { state: undefined, problem: null };
  let raw: unknown;
  try {
    raw = await obj.json();
  } catch {
    return { state: undefined, problem: "state is not JSON" };
  }
  const parsed = parseAggregatorState(raw);
  return parsed.ok
    ? { state: parsed.value, problem: null }
    : { state: undefined, problem: `state rejected: ${parsed.error}` };
}
