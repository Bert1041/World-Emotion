# Phase 6 design: live data (aggregator, snapshot, client polling)

Status: **draft, awaiting decisions L1–L4 (§8).** Scope from docs/PLAN.md §3 Phase 6, plus what
Phase 5 (measured) and Phase 5.5 (the bridge) handed on. Like Phase 5, everything is built and verified
locally first (wrangler dev, local D1 and R2 in Miniflare); the deploy part depends on L1.

## 1. What this phase delivers

The first time the app shows real check-ins:

```
app ──POST /checkin──▶ API Worker ──▶ D1 (votes)
                                        │  every 5 min (cron, same Worker)
                                        ▼
                     core.buildSnapshot(counts, previous state)
                        │                 │                 │ once an hour
                        ▼                 ▼                 ▼
               snapshot.json      aggregator-state.json   archive/<hour>.json
               (public, CDN)      (private)               (public totals, ADR 0007)
                        │
app ◀──GET snapshot.json every 30–60 s (jitter)──┘   tween to the new numbers
```

`packages/core` already holds the whole aggregation as one pure function (pool → shrink → smooth →
hysteresis → publish, with the private state passed in and returned). This phase is the I/O around
it on the server and a second `SnapshotSource` on the client. No maths changes.

## 2. Server

| Piece | Where | Notes |
|---|---|---|
| Cron | `apps/api`, a `scheduled` handler in the same Worker | One deployable, one set of bindings. Every **5 minutes** (G2: reads bind before writes at 2 min). |
| Window query | `apps/api/src/aggregate.ts` | `SELECT country, mood, COUNT(*) … WHERE created_at > ?now-window GROUP BY country, mood`, reading `idx_votes_window` in order (~1 row read per vote, measured in Phase 5). |
| Build | `core.buildSnapshot` | Unchanged. Previous state from R2; on a missing or unparsable state, start fresh (alpha 1) and log it. |
| Writes | R2 bucket | `snapshot.json` (public, `Cache-Control: public, max-age=30`), `aggregator-state.json` (private, never served), and once an hour `archive/YYYY/MM/DD/HH.json`. |
| Order | | State first, then snapshot. If the snapshot write fails, the next run rebuilds it from state; the reverse order could publish numbers the state never saw. |
| Purge | `purgeExpired` (Phase 5) | **Hourly**, not every run: the measured index order makes the purge scan every row. |
| Archive | ADR 0007 | A copy of the published snapshot at the top of the hour, so it holds published regions only by construction. A test feeds a region below the floor and checks it never reaches the archive. |
| Guard | | A run that overlaps the previous one (slow D1) or comes early does nothing: `nextState` already ignores `now <= previous.generatedAt`. |

**Budget per day at 5 min** (README §7, re-measured on real D1 if L1 allows): 288 runs × votes in window
rows read (10k votes ⇒ ~2.9M of 5M); 288 × 2 + 24 R2 writes (~18k a month of 1M); 288 R2 state reads.
Serving `snapshot.json` costs nothing per request **only behind the CDN**, which needs a custom domain
(L1).

## 3. Client

| Piece | Where | Notes |
|---|---|---|
| `PolledSource` | `apps/web/src/data/polled-source.ts` | Second `SnapshotSource`. Fetches `snapshot.json` every 30–60 s with jitter; validates with `parseSnapshot`; keeps the last good snapshot on a bad version, a 500, a parse error or offline; backs off on repeated failure; **does not poll while the tab is hidden** (no cost for background tabs). |
| First paint | | Last good snapshot from `localStorage` if there is one (marked as old), else the quiet world while the first fetch runs. Never demo numbers in production. |
| Tween | `main.ts` / engine | Today only the Earth's theme cross-fades; country colours and the world count **jump** to a new snapshot (invisible at the demo's 2 s steps, a visible snap at 5 min). New: country fills ease in OKLab over ~1.5 s, the count rolls to its new value, weather re-weights gradually. Same for demo and polled sources. |
| Stale data | | If `generatedAt` is more than 15 min old, the header says "Updated 23 min ago". The app keeps working on old numbers (ADR 0006, degrade-not-die). |
| Check-in | `PolledSource.checkIn` | `POST /checkin` with a `deviceKey` (random, made once, `localStorage`) and a fresh `checkinId`. One retry on a network error; then the check-in stays on the device and is sent with the next one (latest only, G7). The full offline queue is Phase 7. |
| Counted where | result line | The response says `counted: "country" \| "world"`. On `world`, the result line re-counts against the world ("Like 1,203 others in the world") and says why once ("Counts for the world: your connection is in another country"). |
| Choice of source | `config.ts` | Production builds use `PolledSource`; `?demo=1` (and dev, until an API is configured) use `DemoSource`. `main.ts` changes one constructor, as the bridge promised. |

## 4. Failure behaviour (ADR 0006: degrade, don't die)

| What breaks | What the user sees |
|---|---|
| Aggregator stops | Last snapshot stays up; after 15 min "Updated N min ago". Check-ins still accepted. |
| `snapshot.json` 5xx / bad version / garbage | Last good snapshot stays; polling backs off. Nothing flashes. |
| API down or rate-limited | The face and result line work from the local snapshot; the check-in is kept and sent next time. |
| Offline | Same as above; the globe and last numbers still render. |
| D1 read budget exhausted | The run fails, the snapshot ages, the header says so. (Phase 8 adds the alarm.) |

## 5. Tests and verification

- **Real storage, no mocks:** aggregator tests run in workerd with local D1 and R2 (`@cloudflare/vitest-pool-workers`, as in Phase 5).
- **End to end, locally:** simulator → `wrangler dev` (D1) → cron triggered with `--test-scheduled` → R2 → the production web build polling it in a real browser, which shows the tween.
- **Client failure paths in a real browser:** Playwright serves a bad version, a 500 and garbage for `snapshot.json`, and the app keeps the last good one.
- Mutation-checked, as every phase.

## 6. Exit criteria

1. End to end locally: simulator → D1 → aggregator → R2 → app shows the tween (Playwright, real browser): a country's fill passes through in-between colours, not a single jump.
2. Rows read per run measured against the G2 budget and written into README §7.
3. Client keeps the last good snapshot on a bad version, a 500 and invalid JSON (verified in a browser).
4. A region below the privacy floor never reaches `snapshot.json` or the archive (test).
5. State-then-snapshot write order: a failed snapshot write is rebuilt on the next run (test).
6. Hourly purge and hourly archive happen once an hour, not on every run (test).
7. The app sends `deviceKey` and shows the `counted` answer; a `world` answer re-counts the result line.
8. No polling while the tab is hidden (browser test).
9. Initial JS within 5 KB of 83.5 KB gz.
10. If L1 = deploy now: real D1 `rows_written` / `rows_read` re-measured; Rate Limiting binding confirmed on the free plan (else the D1-table fallback from Phase 5).

## 7. Not in this phase

Offline queue beyond "latest check-in, sent next time", service worker and PWA (Phase 7); Turnstile
and alarms (Phase 8); "compared to usual" display (ADR 0007: after ~4 weeks of real data).

## 8. Decisions for you

**L1. Domain and Cloudflare account.** `snapshot.json` must be served through Cloudflare's CDN to cost
nothing per read; R2's built-in `r2.dev` address is rate-limited and not meant for production.
- **A (recommended):** build and verify all of Phase 6 locally; buy a domain and create the Cloudflare
  account at the end of the phase, then deploy and re-measure on real D1. Nothing blocks until then.
- B: domain and account now, deploy as we go.
- C: stay local; deploy in Phase 8.

**L2. Moving your pin after checking in.** The vote counts for a country only when it matches your
connection (Phase 5), so the pin mostly changes what you see.
- **A (recommended):** don't re-send. The pin moves your view and the next check-in; your current
  vote stays as counted. No surprise writes, no budget cost.
- B: re-send the current mood with the new country (one more write per move).

**L3. Knowing your connection's country before you check in.** Phase 5 planned to tell you *before*
the tap when a pick will count for the world only, but the API has no read endpoints by design.
- **A (recommended):** learn it from the first check-in's answer, say it right then, and remember it
  on the device for next time. No new endpoint, no cost.
- B: a small `GET /where` once per session: told before the first tap, but one Worker call per visit
  (100k a day on the free plan).

**L4. Polling interval.** README §3 says 30–60 s with jitter.
- **A (recommended):** 45 s ± 15 s. With `max-age=30` on the file, a new snapshot (every 5 min)
  reaches everyone within ~1.5 min.
- B: something else.
