# Phase 5 design: API + D1

Status: **approved** (2026-11-10): A1–A4 as recommended (§7). Scope from docs/PLAN.md §3 Phase 5. Everything runs
locally (wrangler dev, local D1). No Cloudflare account or deploy is needed until Phase 6.

## 1. What gets built

| Piece | Where | Notes |
|---|---|---|
| Migration + rollback | `migrations/0001_init.sql`, `migrations/0001_init.down.sql` | D1 has no "down" migrations, so the rollback is a plain SQL file run with `wrangler d1 execute --local` by a script that counts rows before and after |
| Worker | `apps/api` (Hono, wrangler 4.x) | One write endpoint, `POST /checkin`, plus `OPTIONS` for CORS. No read endpoints: reads stay on the CDN file (README §3) |
| Purge query | `apps/api/src/purge.ts` | Called by the Phase 6 cron. Built and measured here, so README §7's budget uses real numbers |
| Simulator | `tools/simulate` | Spikes, waves, trolls, replays, sent over HTTP to `wrangler dev` |
| Tests | `apps/api/test` | `@cloudflare/vitest-pool-workers`: runs in workerd against a real local D1 (SQLite), not mocks |

The web app does not call the API yet. Wiring it in (check-in → POST, then showing the counted-where
answer) happens in Phase 6, together with polling, so the first end-to-end run uses both halves.

## 2. Request and response

```
POST /checkin
{ "mood": 0-5, "country"?: "CA", "checkinId": uuid, "deviceKey": uuid }
```

- **`deviceKey` is new** in `checkinRequestSchema` (shared). It is the random per-device ID from
  README §5.6. The server stores only `HMAC-SHA256(secret, deviceKey)` (the secret is a Worker
  secret), so the same device always maps to the same row and the raw key is never stored.
- **Validation:** body ≤ 1 KB, strict Zod schema (unknown keys rejected), then
  `isKnownCountry(country)` from geo-data (docs/geo-decisions.md, "Validation boundary").
- **Where the vote counts** (README §5.6, decided 2026-11-09). `conn` = `request.cf.country` when it is
  a known country code; `XX`, `T1` and unknown codes count as no connection country.

  | Picked country | Connection country | Stored `country` | Counts for |
  |---|---|---|---|
  | none | `CA` | `CA` | Canada, North America, world |
  | `CA` | `CA` | `CA` | Canada, North America, world |
  | `US` | `CA` | `NULL` | world only |
  | any / none | unknown | `NULL` | world only |

  The country someone picked but could not count for is **never stored**: less data, and nothing to
  leak (decision A3).
- **Response 200:** `{ "counted": "country" | "world", "conn": "CA" | null, "replay": boolean }`.
  `conn` lets the app correct its default (today it guesses from the browser language) and say
  "This counts for the world only: you seem to be in Canada" (decision A2).
- **Errors:** 400 (invalid input, with no detail beyond the field name), 413 (body too big), 415
  (not JSON), 403 (origin not allowed), 429 (rate limited, with `Retry-After`), 503 (D1 unavailable or
  daily limit reached: the app will show "will count shortly", Phase 8).
- **Unknown connection codes** are logged as `{"event":"unknown_cf_country","code":"XK"}`: no IP, no
  device. This is how Kosovo's real code gets confirmed (geo-decisions G5), once deployed.

## 3. Data model

README §6, with one change: `country` may be `NULL` (world-only votes).

```sql
CREATE TABLE votes (
  voter_hash      TEXT PRIMARY KEY,
  country         TEXT,              -- NULL: counts for the world only (README §5.6)
  mood            INTEGER NOT NULL CHECK (mood BETWEEN 0 AND 5),
  created_at      INTEGER NOT NULL,
  last_checkin_id TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_votes_window ON votes (created_at, country, mood);
```

**One statement per check-in**, idempotent (G7):

```sql
INSERT INTO votes (voter_hash, country, mood, created_at, last_checkin_id) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (voter_hash) DO UPDATE SET
  country = excluded.country, mood = excluded.mood,
  created_at = excluded.created_at, last_checkin_id = excluded.last_checkin_id
WHERE votes.last_checkin_id <> excluded.last_checkin_id;
```

A replay matches the `WHERE`, so nothing is written (expected `rows_written = 0`: measured, not
assumed). `WITHOUT ROWID` stores the row in the primary key's own tree, so there is one less index
to write. Whether that helps is measured against the plain table, and the cheaper one is kept.

**Purge:** `DELETE FROM votes WHERE created_at <= ?` (now − window − 10 min buffer), using the index.

**Measured and written into README §7** (exit criterion): `rows_written` for a first check-in, a
changed mood, a replay, and a purge of N rows. Also `rows_read` for the aggregation `GROUP BY`, as
input to Phase 6's G2 budget.

## 4. Rate limiting (G8)

With the 2026-11-09 rule, country-hopping no longer works: a pick that does not match the connection
counts for the world only. So the separate "country change" limit in README §5.6 is no longer
needed, and a single limit covers floods (decision A1).

- **Store: Workers Rate Limiting binding.** It costs no D1 writes. A D1 table would cost at least
  one write per check-in, roughly halving the ~25k check-ins/day the budget allows. The binding's
  limits are approximate and counted separately in each Cloudflare location (developers.cloudflare.com,
  updated 2026-10-21). That is fine for throttling and wrong for anything strict.
- **Key:** `SHA-256(dailySalt + IP)`, where the salt is derived from a Worker secret and the UTC date
  (README §5.6: throttling without storing IPs; the binding keeps only the hash, briefly). A second
  binding is keyed by device hash.
- **Limits (starting points, tuned with the simulator):** 10 check-ins / 60 s per IP hash (households
  and offices share an IP), and 3 / 60 s per device.
- **Not verified: whether the binding is available on the Workers Free plan.** The docs page does not
  say. Checking it needs a Cloudflare account (Phase 6). If it isn't available, the fallback is a D1
  counter table, with the write cost recorded in README §7.

## 5. CORS and boundaries

- `ALLOWED_ORIGINS` (env) is an exact-match list: `http://localhost:5173` and `:4173` for dev; the
  real domain is added in Phase 6. No credentials, no wildcard. `OPTIONS` answers only for allowed
  origins.
- Only `POST /checkin` and `OPTIONS /checkin` exist. Everything else returns 404, and a wrong method
  returns 405.
- Time comes from the server only (`Date.now()`), never the client.
- Secrets (`DEVICE_HASH_SECRET`, `IP_SALT_SECRET`) are in `.dev.vars` locally (gitignored, with a
  committed `.dev.vars.example`). In production they are Worker secrets.

## 6. Exit criteria (PLAN.md, made concrete)

1. **Forward and rollback:** apply 0001 to an empty local D1 and count the tables, the index and 0
   rows. Seed N votes with the simulator and count N. Run the rollback, which leaves no table, and
   confirm nothing else is removed (the `d1_migrations` bookkeeping row is handled). Then apply again
   and confirm it works twice.
2. **`rows_written` measured** for each case in §3, written into README §7, with the budget table
   corrected.
3. **Simulator against `wrangler dev`:** a spike (1k devices in 10 s; 429s appear, nothing is
   double-counted), waves, a troll (one IP across 50 countries counts for the world only, apart from
   its connection country), replays (counts don't change, `rows_written` 0), and the purge. Each
   run's totals are checked by querying the local D1 directly.
4. **Boundary tests:** CORS (allowed, disallowed, preflight), each 4xx above, an oversized body,
   unknown keys, an unknown country, `XX` and `T1`, a picked country that doesn't match.
5. **Every behavioural test is mutation-checked**, and the mutations are listed in the PR.
6. `pnpm check` and CI pass. The web bundle is unchanged.

## 7. Decisions (approved 2026-11-10, all as recommended)

- **A1:** drop README §5.6's separate country-change limit (now redundant) and keep one flood limit.
  *Recommend: yes.*
- **A2:** the app learns the connection country from the check-in **response**, not a separate
  `GET /where` call on every visit. A `GET` per visit would spend the 100k/day Worker request budget
  on reads, which README §2 rules out. The cost: the app can only say "this will count for the world
  only" after the first check-in, not before. *Recommend: response.*
- **A3:** don't store a picked country that didn't count (store `NULL`). *Recommend: yes.*
- **A4:** rate-limit store: binding, with a D1 table as fallback if the free plan lacks it.
  *Recommend: binding.*
