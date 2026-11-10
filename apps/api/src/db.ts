/** The only SQL the API runs (docs/design/phase-5-api.md §3). */

/**
 * One statement per check-in. A replay (same `last_checkin_id`) matches no row in the `WHERE`,
 * so nothing is written and `created_at` is not refreshed (README G7).
 */
export const UPSERT_VOTE = `
INSERT INTO votes (voter_hash, country, mood, created_at, last_checkin_id) VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT (voter_hash) DO UPDATE SET
  country = excluded.country, mood = excluded.mood,
  created_at = excluded.created_at, last_checkin_id = excluded.last_checkin_id
WHERE votes.last_checkin_id <> excluded.last_checkin_id`;

export interface Vote {
  readonly voterHash: string;
  readonly country: string | null;
  readonly mood: number;
  readonly createdAt: number;
  readonly checkinId: string;
}

export interface WriteResult {
  readonly replay: boolean;
  readonly rowsWritten: number;
}

export async function saveVote(db: D1Database, v: Vote): Promise<WriteResult> {
  const r = await db
    .prepare(UPSERT_VOTE)
    .bind(v.voterHash, v.country, v.mood, v.createdAt, v.checkinId)
    .run();
  return { replay: r.meta.changes === 0, rowsWritten: r.meta.rows_written };
}

import { PURGE_BUFFER_SECONDS, PURGE_SQL } from "./purge-sql";

export { PURGE_BUFFER_SECONDS, PURGE_SQL };

/**
 * Deletes votes no longer in any window. Active means `now - window < created_at`
 * (packages/core window.ts), so `created_at <= now - window - buffer` is safely expired.
 * Called by the Phase 6 cron; measured here (README §7, G1).
 */
export async function purgeExpired(
  db: D1Database,
  nowSeconds: number,
  windowSeconds: number,
): Promise<{ deleted: number; rowsRead: number; rowsWritten: number }> {
  const r = await db
    .prepare(PURGE_SQL)
    .bind(nowSeconds - windowSeconds - PURGE_BUFFER_SECONDS)
    .run();
  return { deleted: r.meta.changes, rowsRead: r.meta.rows_read, rowsWritten: r.meta.rows_written };
}
