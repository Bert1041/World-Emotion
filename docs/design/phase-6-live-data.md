# Phase 6 design: live data (aggregator, snapshot, client polling)

Status: **approved** (2026-11-22): L1–L4 as recommended (§8): local first, domain and deploy at the end of the phase; no re-send on a pin move; connection country learnt from the first check-in; polling 45 s ± 15 s. Scope from docs/PLAN.md §3 Phase 6, plus what
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
| Writes | two R2 buckets | Public `world-emotion-snapshots`: `snapshot.json` (`Cache-Control: public, max-age=30`) and once an hour `archive/YYYY/MM/DD/HH.json`. Private `world-emotion-private`: `aggregator-state.json`. Separate because a public bucket exposes every object, and the state holds sub-floor numbers (found 2026-11-22, before any public address). |
| Order | | State first, then snapshot. If the snapshot write fails, the next run rebuilds it from state; the reverse order could publish numbers the state never saw. |
| Purge | `purgeExpired` (Phase 5) | **Hourly**, not every run: the measured index order makes the purge scan every row. |
| Archive | ADR 0007 | A copy of the published snapshot at the top of the hour, so it holds published regions only by construction. A test feeds a region below the floor and checks it never reaches the archive. |
| Local serving | `GET /snapshot.json` in the Worker, **only with `SIMULATE=1`** | On a laptop nothing else serves R2, so the app polls the Worker. In production it answers 404 and the CDN serves the file (the API keeps no read endpoints). **Deploy note:** the R2 bucket needs a CORS rule allowing `GET` from the app's origin, since the app fetches the file cross-origin. |
| Guard | | A run that overlaps the previous one (slow D1) or comes early does nothing: `nextState` already ignores `now <= previous.generatedAt`. |

**Budget per day at 5 min** (README §7, re-measured on real D1 if L1 allows): 288 runs × votes in window
rows read (10k votes ⇒ ~2.9M of 5M); 288 × 2 + 24 R2 writes (~18k a month of 1M); 288 R2 state reads.
Serving `snapshot.json` costs nothing per request **only behind the CDN**, which needs a custom domain
(L1).

## 3. Client

| Piece | Where | Notes |
|---|---|---|
| `PolledSource` | `apps/web/src/data/polled-source.ts` | Second `SnapshotSource`. Fetches `snapshot.json` every 45 s ± 15 s with `cache: "no-cache"` (the browser's own 30 s copy must not answer a poll; an unchanged file costs a 304 from the edge); validates with `parseSnapshot`; takes it only if newer; keeps the last good snapshot on a bad version, a 500, invalid JSON or offline; doubles the wait after failures, up to 5 min; **does not poll while the tab is hidden**. |
| First paint | | Last good snapshot from `localStorage` if there is one (marked as old), else the quiet world while the first fetch runs. Never demo numbers in production. |
| Tween | `engine/fill-tween.ts` | Today only the Earth's theme cross-fades; country colours **jump** to a new snapshot (invisible at the demo's 2 s steps, a visible snap at 5 min). New: fills ease in OKLab over `DURATION.data` (1.5 s), only when a colour visibly changes, instant under reduced motion. Already eased, so unchanged: the world count (`Counter.svelte` rolls) and weather (particles live out their time before new spawn points take over). |
| Stale data | | If `generatedAt` is more than 15 min old, the header says "Updated 23 min ago". The app keeps working on old numbers (ADR 0006, degrade-not-die). |
| Check-in | `PolledSource.checkIn` | `POST /checkin` with a `deviceKey` (random, made once, `localStorage`) and a fresh `checkinId`. One retry on a network error; then the check-in stays on the device and is sent with the next one (latest only, G7). The full offline queue is Phase 7. |
| Counted where | result line | The response says `counted: "country" \| "world"`. On `world`, the result line re-counts against the world ("Like 1,203 others in the world") and says why once ("Counts for the world: your connection is in another country"). |
| Choice of source | `config.ts` | Builds with `VITE_SNAPSHOT_URL` and `VITE_API_URL` (set at deploy) use `PolledSource`; without them, and with `?demo=1` or a bench run, `DemoSource`. `?live=<local API>` is honoured only on a page served from `localhost`/`127.0.0.1` and only toward this machine, so a link to the real site cannot show a made-up world. `main.ts` changes one constructor, as the bridge promised. |

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
- **End to end, locally:** `e2e/live.spec.ts`. Playwright starts the real API beside the app (`wrangler dev`, a fresh local D1 and R2 per run, `SIMULATE=1`); check-ins go in over HTTP, the cron is triggered over HTTP, and the production build polls the result in a real browser.
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
