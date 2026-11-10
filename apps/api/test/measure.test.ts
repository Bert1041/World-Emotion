/**
 * Real D1 `rows_written` per operation (exit criterion 2; README §7 and G1). Run against the
 * shipped schema and, for comparison, the same table with a rowid (decides WITHOUT ROWID).
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { purgeExpired, saveVote, UPSERT_VOTE } from "../src/db";

const ROWID_DDL = `CREATE TABLE IF NOT EXISTS votes_rowid (
  voter_hash TEXT PRIMARY KEY, country TEXT, mood INTEGER NOT NULL, created_at INTEGER NOT NULL,
  last_checkin_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_votes_rowid_window ON votes_rowid (country, mood, created_at);`;

async function costs(table: "votes" | "votes_rowid") {
  const sql = UPSERT_VOTE.replaceAll("votes", table);
  const run = async (h: string, country: string | null, mood: number, at: number, id: string) =>
    (await env.DB.prepare(sql).bind(h, country, mood, at, id).run()).meta;
  const h = `measure-${table}-${crypto.randomUUID()}`;
  // Far-future times: other tests' purges (cut-offs near "now") never touch these rows.
  const t0 = 9_000_000_000;
  const first = await run(h, "CA", 1, t0, "a");
  const replay = await run(h, "CA", 1, t0, "a");
  const change = await run(h, "CA", 4, t0 + 60, "b");
  const sameAll = await run(h, "CA", 4, t0 + 60, "c"); // new id, same values
  const toWorld = await run(h, null, 4, t0 + 120, "d");
  return { first, replay, change, sameAll, toWorld };
}

describe("rows_written per check-in (measured)", () => {
  it("records the cost of each case for both layouts", async () => {
    await env.DB.exec(ROWID_DDL.replaceAll("\n", " "));
    const out: Record<string, Record<string, number>> = {};
    for (const t of ["votes", "votes_rowid"] as const) {
      const c = await costs(t);
      out[t] = Object.fromEntries(Object.entries(c).map(([k, m]) => [k, m.rows_written]));
    }
    console.log("ROWS_WRITTEN", JSON.stringify(out));
    // Measured 2026-11-10 in local D1 (wrangler 4.153). Pinned so a schema change that costs
    // more writes fails here and gets README §7 updated. WITHOUT ROWID saves 1 on insert.
    expect(out.votes).toEqual({ first: 2, replay: 0, change: 2, sameAll: 2, toWorld: 2 });
    expect(out.votes_rowid).toEqual({ first: 3, replay: 0, change: 2, sameAll: 2, toWorld: 2 });
  });

  it("records the cost of purging N expired votes, and keeps the active ones", async () => {
    const now = 1_000_000; // far past: no other test writes rows this old
    const window = 21_600;
    const cut = now - window - 600;
    for (let i = 0; i < 50; i++)
      await saveVote(env.DB, {
        voterHash: `purge-old-${i}`,
        country: "CA",
        mood: i % 6,
        createdAt: cut - i, // the first sits exactly on the cut: expired
        checkinId: `x${i}`,
      });
    for (let i = 0; i < 7; i++)
      await saveVote(env.DB, {
        voterHash: `purge-new-${i}`,
        country: null,
        mood: 0,
        createdAt: cut + 1 + i, // one second inside the buffer: kept
        checkinId: `y${i}`,
      });
    const stored = await env.DB.prepare("SELECT count(*) AS n FROM votes").first<{ n: number }>();
    const r = await purgeExpired(env.DB, now, window);
    console.log("PURGE", JSON.stringify({ ...r, storedBefore: stored?.n }));
    // Locally: 1 write per deleted vote; the purge scans the whole index (country first), so it
    // reads every stored vote. Hence Phase 6 purges hourly, not every run (design §3).
    expect(r).toEqual({ deleted: 50, rowsRead: stored?.n, rowsWritten: 50 });
    const left = await env.DB.prepare(
      "SELECT count(*) AS n FROM votes WHERE voter_hash LIKE 'purge-%'",
    ).first<{ n: number }>();
    expect(left?.n).toBe(7);
  });

  it("records rows_read for the aggregation query over N votes in the window (Phase 6, G2)", async () => {
    const t = 2_000_000; // its own time range: no other test's rows fall in this window
    for (let i = 0; i < 40; i++)
      await saveVote(env.DB, {
        voterHash: `agg-${i}`,
        country: i % 4 === 0 ? null : (["CA", "FR", "BR"][i % 3] ?? null),
        mood: i % 6,
        createdAt: t - i * 10,
        checkinId: `z${i}`,
      });
    const r = await env.DB.prepare(
      `SELECT country, mood, count(*) AS n FROM votes
       WHERE created_at > ?1 AND created_at <= ?2 GROUP BY country, mood`,
    )
      .bind(t - 21_600, t)
      .run();
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT country, mood, count(*) FROM votes
       WHERE created_at > ?1 AND created_at <= ?2 GROUP BY country, mood`,
    )
      .bind(t - 21_600, t)
      .all<{ detail: string }>();
    const stored = await env.DB.prepare("SELECT count(*) AS n FROM votes").first<{ n: number }>();
    console.log(
      "AGG",
      JSON.stringify({ rows_read: r.meta.rows_read, stored: stored?.n, plan: plan.results }),
    );
    const total = (r.results as { n: number }[]).reduce((a, b) => a + b.n, 0);
    expect(total).toBe(40);
    const detail = plan.results.map((p) => p.detail).join(" | ");
    expect(detail).toContain("COVERING INDEX idx_votes_window");
    expect(detail, "no billed sort").not.toContain("TEMP B-TREE");
    // One row read per stored vote (in the window or not yet purged), not 2 per vote.
    expect(r.meta.rows_read).toBe(stored?.n);
  });
});
