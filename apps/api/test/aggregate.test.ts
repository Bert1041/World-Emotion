/**
 * The aggregator against real local D1 and R2 (docs/design/phase-6-live-data.md §5, exit criteria
 * 2, 4, 5, 6). Times are in 2001, which no other test file uses, so these runs' windows and purges
 * never meet another file's rows, whether or not files share storage.
 */
import { env } from "cloudflare:workers";
import { parseSnapshot, type Snapshot } from "@world-emotion/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveKey,
  runAggregation,
  SNAPSHOT_CACHE_CONTROL,
  SNAPSHOT_KEY,
  STATE_KEY,
} from "../src/aggregate";
import { call } from "./helpers";

/** 2001-09-09 02:00:00 UTC, the top of an hour. Each test takes its own day. */
const H0 = 1_000_000_800;
let day = 0;
const nextDay = () => H0 + ++day * 86_400;
const MIN = 60;
const HOUR = 3600;

async function vote(country: string | null, mood: number, at: number, times = 1): Promise<void> {
  for (let i = 0; i < times; i++)
    await env.DB.prepare(
      "INSERT INTO votes (voter_hash, country, mood, created_at, last_checkin_id) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(`agg-${crypto.randomUUID()}`, country, mood, at, crypto.randomUUID())
      .run();
}

async function snapshot(): Promise<Snapshot> {
  const obj = await env.SNAPSHOTS.get(SNAPSHOT_KEY);
  expect(obj, "snapshot.json written").not.toBeNull();
  const parsed = parseSnapshot(await (obj as R2ObjectBody).json());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

beforeEach(async () => {
  for (const bucket of [env.SNAPSHOTS, env.STATE]) {
    const listed = await bucket.list();
    await bucket.delete(listed.objects.map((o) => o.key));
  }
});

describe("runAggregation", () => {
  it("counts the window: inside yes, expired and future no; world-only votes in the world alone", async () => {
    const now = nextDay() + 5 * MIN;
    await vote("CA", 1, now - MIN, 6);
    await vote("CA", 2, now - 6 * HOUR); // exactly window-old: expired (half-open window)
    await vote("US", 3, now + MIN); // future-dated (clock skew): never counts
    // World only. Five, not fewer: world minus its published continents would otherwise leave
    // 1-4 votes, and complementary suppression (core) would hide North America to protect them.
    await vote(null, 4, now - 100, 5);

    const r = await runAggregation(env, now);
    expect(r.wrote).toBe(true);
    const s = await snapshot();
    expect(s.generatedAt).toBe(now);
    expect(s.world.n).toBe(11);
    expect(s.countries.CA?.n).toBe(6);
    expect(s.countries.US).toBeUndefined();
    expect(s.continents.NA?.n).toBe(6);

    const head = await env.SNAPSHOTS.head(SNAPSHOT_KEY);
    expect(head?.httpMetadata?.cacheControl).toBe(SNAPSHOT_CACHE_CONTROL);
    expect(head?.httpMetadata?.contentType).toBe("application/json");
  });

  it("the public bucket holds only the snapshot and the archive; the state is in the private one", async () => {
    // A public bucket exposes every object in it, and the state keeps sub-floor numbers.
    const now = nextDay() + 5 * MIN;
    await vote("FR", 0, now - MIN, 4); // below the floor: in the state, never public
    await vote("CA", 1, now - MIN, 6);
    await runAggregation(env, now);
    const publicKeys = (await env.SNAPSHOTS.list()).objects.map((o) => o.key);
    expect(publicKeys.sort()).toEqual([archiveKey(now), SNAPSHOT_KEY].sort());
    const privateKeys = (await env.STATE.list()).objects.map((o) => o.key);
    expect(privateKeys).toEqual([STATE_KEY]);
  });

  it("privacy floor: a country with 4 votes is in neither the snapshot nor the archive", async () => {
    const now = nextDay() + 5 * MIN;
    await vote("FR", 0, now - MIN, 4);
    await vote("CA", 1, now - MIN, 6);
    const r = await runAggregation(env, now);

    const s = await snapshot();
    expect(s.world.n).toBe(10);
    expect(s.countries.FR).toBeUndefined();
    expect(s.continents.EU).toBeUndefined();
    expect(r.archived).toBe(archiveKey(now));
    const archived = await (
      (await env.SNAPSHOTS.get(r.archived as string)) as R2ObjectBody
    ).json<Snapshot>();
    expect(archived).toEqual(s);
    expect(JSON.stringify(archived)).not.toContain('"FR"');
  });

  it("a second run smooths toward new numbers, from the state the first one saved", async () => {
    const t = nextDay() + 5 * MIN;
    await vote("CA", 0, t - MIN, 10);
    await runAggregation(env, t);
    await vote("CA", 5, t + MIN, 10); // as many votes for another mood
    await runAggregation(env, t + 5 * MIN);

    const s = await snapshot();
    expect(s.world.n).toBe(20);
    // Raw counts are now equal; smoothing keeps the earlier mood ahead for a while.
    expect(s.world.dist[0]).toBeGreaterThan(s.world.dist[5] as number);
    const state = await ((await env.STATE.get(STATE_KEY)) as R2ObjectBody).json<{
      generatedAt: number;
    }>();
    expect(state.generatedAt).toBe(t + 5 * MIN);
  });

  it("a run at or before the last one writes nothing", async () => {
    const t = nextDay() + 5 * MIN;
    await vote("CA", 1, t - MIN, 6);
    await runAggregation(env, t);
    const before = await env.SNAPSHOTS.head(SNAPSHOT_KEY);
    const stateBefore = await env.STATE.head(STATE_KEY);
    await new Promise((r) => setTimeout(r, 5)); // so a rewrite would get a later upload time

    for (const at of [t, t - MIN]) {
      const r = await runAggregation(env, at);
      expect(r.wrote, `run at ${at - t} s`).toBe(false);
    }
    // Upload times, not etags: a rewrite of identical content keeps the etag (a content hash).
    expect((await env.SNAPSHOTS.head(SNAPSHOT_KEY))?.uploaded.getTime()).toBe(
      before?.uploaded.getTime(),
    );
    expect((await env.STATE.head(STATE_KEY))?.uploaded.getTime()).toBe(
      stateBefore?.uploaded.getTime(),
    );
  });

  it("an unreadable state: starts fresh and says why", async () => {
    const t = nextDay() + 5 * MIN;
    await vote("CA", 1, t - MIN, 6);
    await env.STATE.put(STATE_KEY, "{not json");
    const a = await runAggregation(env, t);
    expect(a.freshState).toBe(true);
    expect(a.stateProblem).toBe("state is not JSON");

    await env.STATE.put(STATE_KEY, JSON.stringify({ v: 999 }));
    const b = await runAggregation(env, t + 5 * MIN);
    expect(b.freshState).toBe(true);
    expect(b.stateProblem).toMatch(/^state rejected: /);
    expect((await snapshot()).generatedAt).toBe(t + 5 * MIN);
  });

  it("writes the state before the snapshot; a failed snapshot write is rebuilt by the next run", async () => {
    const t = nextDay() + 5 * MIN;
    await vote("CA", 1, t - MIN, 6);
    // Real R2, with the snapshot write made to fail.
    const failing = new Proxy(env.SNAPSHOTS, {
      get(target, prop, receiver) {
        if (prop === "put")
          return (key: string, ...rest: unknown[]) => {
            if (key === SNAPSHOT_KEY) return Promise.reject(new Error("R2 put failed"));
            return (target.put as (...a: unknown[]) => Promise<unknown>).call(target, key, ...rest);
          };
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(
      runAggregation({ DB: env.DB, SNAPSHOTS: failing, STATE: env.STATE }, t),
    ).rejects.toThrow("R2 put failed");
    expect(await env.STATE.head(STATE_KEY), "state saved first").not.toBeNull();
    expect(await env.SNAPSHOTS.head(SNAPSHOT_KEY)).toBeNull();

    const r = await runAggregation(env, t + 5 * MIN);
    expect(r.freshState, "the next run builds on the saved state").toBe(false);
    expect((await snapshot()).generatedAt).toBe(t + 5 * MIN);
  });

  it("archives and purges once an hour, not on every run", async () => {
    const h = nextDay();
    const old = h - 7 * HOUR; // past window + buffer by the first run: purged
    await vote("CA", 1, old);
    await vote("CA", 1, h, 6);
    const at = (t: number) =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE created_at = ?")
        .bind(t)
        .first<number>("n");
    const runs = [h + 5 * MIN, h + 10 * MIN, h + 55 * MIN, h + HOUR, h + HOUR + 5 * MIN];
    const reports = [];
    for (const at of runs) reports.push(await runAggregation(env, at));

    expect(reports.map((r) => r.archived)).toEqual([
      archiveKey(h + 5 * MIN),
      null,
      null,
      archiveKey(h + HOUR),
      null,
    ]);
    expect(reports.map((r) => r.purged !== null)).toEqual([true, false, false, true, false]);
    // Earlier tests' 2001 votes are older still and go too, so check the rows, not the count.
    expect(await at(old), "the expired vote").toBe(0);
    expect(await at(h), "votes in the window").toBe(6);
    const keys = (await env.SNAPSHOTS.list({ prefix: "archive/" })).objects.map((o) => o.key);
    expect(keys.sort()).toEqual([archiveKey(h), archiveKey(h + HOUR)].sort());
  });

  it("rows read per run is about one per stored vote, in the window or not (G2 budget, measured)", async () => {
    // The index leads with country, so the time filter cannot narrow the scan: every stored row
    // is read, including expired ones the hourly purge has not removed yet (Phase 5 measured the
    // same). Bounded by the table's own row count, so other files' rows cannot skew it.
    const t = nextDay() + 5 * MIN;
    const stored = () => env.DB.prepare("SELECT COUNT(*) AS n FROM votes").first<number>("n");
    const seen: { inWindow: number; stored: number; read: number }[] = [];
    let total = 0;
    for (const n of [50, 200]) {
      await vote("CA", n % 6, t - MIN, n - total);
      total = n;
      const rowsStored = (await stored()) ?? 0;
      const r = await runAggregation(env, t + seen.length * 5 * MIN);
      seen.push({ inWindow: n, stored: rowsStored, read: r.rowsRead });
    }
    console.log("ROWS_READ_PER_RUN", JSON.stringify(seen));
    for (const s of seen) {
      expect(s.read, JSON.stringify(s)).toBeGreaterThanOrEqual(s.inWindow);
      expect(s.read, JSON.stringify(s)).toBeLessThanOrEqual(s.stored + 10);
    }
  });
});

describe("GET /snapshot.json (local development only)", () => {
  it("is served from R2 when SIMULATE=1, for the app on a laptop to poll", async () => {
    const now = nextDay() + 5 * MIN;
    await vote("CA", 1, now - MIN, 6);
    await runAggregation(env, now);
    const res = await call(null, { method: "GET", path: "/snapshot.json", env: { SIMULATE: "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(SNAPSHOT_CACHE_CONTROL);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const s = parseSnapshot(await res.json());
    expect(s.ok && s.value.generatedAt).toBe(now);
  });

  it("is not served in production: the API has no read endpoints (the CDN serves the file)", async () => {
    const now = nextDay() + 5 * MIN;
    await vote("CA", 1, now - MIN, 6);
    await runAggregation(env, now);
    const res = await call(null, { method: "GET", path: "/snapshot.json" }); // SIMULATE "0"
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("generatedAt");
  });
});
