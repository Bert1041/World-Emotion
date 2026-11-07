# World Emotion — Delivery Plan

Companion to `README.md` (the spec). The README says **what** and **why**; this file says **in what order, how we know a phase is done, and what is still undecided**.

Status: **Phase 3 (+3b) complete on branch `phase-3/globe-spike`, awaiting PR review: Canvas 2D GO ([ADR 0005](decisions/0005-globe-go-no-go.md)).** Phases 0–2 merged.

Previous status: **Phase 0 complete (2026-11-05), awaiting sign-off. Decisions D1–D4 accepted ([ADR 0001](decisions/0001-launch-product-decisions.md)); gaps G1–G10 written into README revision 3.**

### Phase 0 report
```
Exit criteria: met
  - pnpm check = lint → typecheck → test, exits 0 on baseline
  - G1–G10 resolved into README rev 3; D1–D4 recorded in ADR 0001
Mutations run (each made `pnpm check` exit 1, then restored):
  - type error in packages/shared only (runtime tests still pass) → caught by typecheck
  - failing assertion in packages/core → caught by vitest
  - all test files removed → caught (passWithNoTests: false)
  - unused variable + `==` → caught by biome lint
Verified: all 103 resolved packages (incl. transitive/platform binaries) published ≥14 days ago
NOT verified: CI (no remote yet) → addressed in Phase 0.5
Incidents: biome formatted README.md during setup → restored byte-identical from
  ~/Downloads/README.md (cmp), Markdown now excluded. `biome migrate` disabled all
  lint rules → fixed, see ADR 0002.
```

---

## 0. How we work

- **One branch + pull request per phase.** Merging the PR is the phase sign-off; CI must be green.
- **One phase at a time.** A phase starts only when the previous phase's exit criteria are met and reviewed.
- **Every phase has exit criteria that can be checked.** "It works" is not an exit criterion.
- **Tests are mutation-checked.** For every test that guards behaviour: break the code, watch the test fail, restore it. Each phase report lists the mutations run.
- **No mocks for data.** Anything touching D1/R2 is verified against local Miniflare (real SQLite) via `wrangler dev`, not stubs.
- **Each phase ends with a report** listing what was verified, what was not, and any adjacent findings, each as a decision to make (fix now / ticket).
- **Non-obvious choices get a decision record** in `docs/decisions/NNNN-title.md`.

---

## 1. Spec review: gaps to resolve before building

These come from reading the README closely. Each one would ship as a defect if built as written.

| #   | Where     | Gap                                                                                                                                                                                                                                                               | Recommendation                                                                                                                                                                                        |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | §7 budget | **Purging expired votes costs writes too.** A `DELETE` counts as rows written (row + index entry). The lifetime of a new device's vote is ~2 writes on insert + ~2 on purge, about 4 in total, so the write ceiling is nearer **~25k check-ins/day**, not 30–40k. | Correct the table. Measure real `meta.rows_written` per check-in and purge in Phase 5, rather than estimating.                                                                                        |
| G2  | §7 budget | **Reads bind before writes at a 2-minute cadence.** 720 runs/day × 10k votes in window = 7.2M rows read, above the 5M cap. Break-even at 2 min is ~6.9k votes in window.                                                                                          | Launch at **5-minute** aggregation (288 runs → ~2.9M at 10k). Stage 2 trigger stays as written.                                                                                                       |
| G3  | §5.5      | **Smoothing `0.7/0.3` is per snapshot, so the "feel" changes if cadence changes.**                                                                                                                                                                                | Express smoothing as a **half-life in minutes** and derive alpha from elapsed time. The cadence can then be retuned without touching feel.                                                            |
| G4  | §5.5      | **Smoothing and hysteresis need state from the previous run** (previous distribution, current headline, challenger + streak). The spec never says where that state lives.                                                                                         | Aggregator reads the previous published snapshot from R2 (one Class B op/run). Hysteresis state goes in a small private `aggregator-state.json` in R2, not in the public snapshot.                    |
| G5  | §5.4      | **Shrinkage chain is undefined above country.** What does a continent with 3 votes shrink toward? What is the world with 0 votes?                                                                                                                                 | Country → continent → world → uniform prior. Same formula at each level. World with n=0 renders the "quiet" state.                                                                                    |
| G6  | §6        | **Does the snapshot hold raw or processed distributions?** Undefined.                                                                                                                                                                                             | Publish the **final** distribution (shrunk + smoothed) plus **raw `n`**. Clients never redo maths, and every client agrees.                                                                           |
| G7  | §6        | **Idempotency key has no column, and a replayed offline check-in would refresh `created_at`**, extending its window.                                                                                                                                              | Store `last_checkin_id`. If it matches, return 200 with **no write** (this also saves budget). The offline queue holds **only the latest** check-in per device, so out-of-order replays can't happen. |
| G8  | §5.6      | **Manual country override:** the client supplies the country, but the spec doesn't say where rate-limit counters live.                                                                                                                                            | Validate against the generated ISO list. Rate-limit store is decided in Phase 5: Workers Rate Limiting binding (verify free-plan availability) vs. a D1 table (which costs writes).                   |
| G9  | §3        | **`request.cf.country` returns non-country values** (`XX` unknown, `T1` Tor).                                                                                                                                                                                     | Treat as "unknown": ask the user to pick a country, or count the vote toward the world only.                                                                                                          |
| G10 | §11/§12   | Section order is 11 after 12.                                                                                                                                                                                                                                     | Cosmetic; fix while editing.                                                                                                                                                                          |

---

## 2. Open decisions

**Blocks Phase 1** (core logic depends on them):
- **D1 Mood list:** 6 or 8, plus exact labels. The README's weather/palette already defines 6 (happy, calm, excited, stressed, sad, angry). _Recommend: ship those 6._
- **D2 Window:** fixed 6 h or timezone-adaptive. _Recommend: fixed 6 h, as a constant that is easy to change._
- **D3 World weighting:** pure pool or population-weighted. _Recommend: pure pool at launch (honest, simple), and say so on the page._
- **D4 Gap fixes G1–G9** above: accept, or amend.

**Phase 3 device:** Pixel 6 Pro, the only reference device (ADR 0004, low-end risk accepted).

**Can wait:** sound (recommend: post-launch), domain/brand (needed before Phase 6 for the CDN), daily history (recommend: none at launch).

---

## 3. Phases

### Phase 0: Foundations

**Scope:** `git init`, pnpm workspace, strict TS base config, Vitest, one lint/format tool, empty `packages/{core,shared}` with a smoke test, `docs/decisions/` with ADR template, `docs/licenses.md`.
**Exit criteria:**
- `pnpm check` runs typecheck **and** tests across the workspace. (Vitest alone doesn't typecheck, which is how a "green suite on a file that doesn't compile" happens.)
- Harness mutation: introduce a type error → `pnpm check` fails; introduce a failing assertion → fails; restore → passes.
- Gaps G1–G10 resolved into the README (or explicitly rejected with reasons).
  **Not in scope:** CI (needs a remote), any app code.

### Phase 0.5: CI gate (pulled forward from Phase 8)
**Scope:** GitHub Actions runs `pnpm check` on every push; actions pinned to commit SHAs; Node raised to 26.
**Exit criteria:** a green run on the branch, **and** a red run on a deliberately broken commit (CI mutation check).

### Phase 1: `packages/core` + `packages/shared`

**Scope:** mood enum, window expiry, pooling (country/continent/world), shrinkage chain (G5), time-based smoothing (G3), headline hysteresis, snapshot schema (Zod, versioned), check-in request schema.
**Exit criteria:**
- Edge cases tested: zero votes, one vote, exact ties, near-ties at the hysteresis margin, sudden spike, single troll country, cadence change keeps the same smoothing feel, unknown snapshot version rejected.
- Every behavioural test mutation-checked; mutations listed in the phase report.
- Zero imports of I/O or Cloudflare APIs (enforced by a lint rule, not by convention).

### Phase 2: `packages/geo-data`

**Scope:** build script from Natural Earth → country→continent map + trimmed TopoJSON (low and high LOD); `docs/geo-decisions.md`.
**Exit criteria:**
- **Every** feature in the TopoJSON maps to exactly one continent: a test asserts it over the full set, not a sample.
- Every ISO code accepted by the check-in schema exists in the map, and the reverse holds too.
- TopoJSON sizes measured and recorded (gzipped) per LOD.
- Natural Earth version + licence recorded.

### Phase 3: Globe performance spike (go/no-go)

**Scope:** minimal `apps/web` with a d3-geo orthographic canvas, drag/inertia, tap-to-select, idle particles, driven by a fake snapshot. Dev overlay (frame time, particles, DPR).
**Exit criteria:**
- Measured on the **physical reference phone**: median and p95 frame time during drag with particles. Numbers go in a decision record with GO / fallback path (OffscreenCanvas → WebGL).
- Spike code is either promoted deliberately (reviewed) or deleted. No accidental keep.
  **Device:** Pixel 6 Pro via USB (ADR 0004).

### Phase 4: `packages/motion` + check-in moment

**Scope:** fixed-step springs, easing, OKLab interpolation, great-circle rotation interpolation, solar position, motion tokens. Wire the check-in moment first (spec §8.2.5).
**Exit criteria:** maths unit-tested and mutation-checked; same spring result at 60 Hz and 120 Hz step rates (a test that steps both); check-in moment reviewed on the reference phone; `prefers-reduced-motion` path verified in a real browser.

### Phase 5: API + D1

**Scope:** `migrations/0001_init.sql` (+ rollback), Hono Worker `POST /checkin`, Zod validation **plus `isKnownCountry` membership check** (docs/geo-decisions.md), log unknown `cf.country` codes (verify Kosovo), idempotency (G7), country derivation (G9), manual override + rate limit (G8), `tools/simulate`.
**Exit criteria:**
- Migration forward **and** rollback run against local D1; row counts checked before/after both.
- Real `rows_written` per check-in, per replay (expect 0) and per purge, measured and written back into README §7.
- Simulator runs spikes/waves/trolls against `wrangler dev`, not against mocks.
- CORS and input validation tested at the boundary.

### Phase 6: Aggregator + snapshot + client polling

**Scope:** cron Worker, Stage 1 aggregation, R2 write, state file (G4), purge, client polling with jitter + tweening, version rejection.
**Exit criteria:** end-to-end locally: simulator → D1 → aggregator → R2 → app shows tween. Rows read per run measured against the G2 budget. Client keeps the last good snapshot on a bad version/500 (verified in a browser).
**Needs from you:** domain decision.

### Phase 7: PWA, offline, accessibility, sharing

**Scope:** vite-plugin-pwa, offline queue (latest-only), foreground retry, accessible list/table view, keyboard nav, Natural Earth + GeoNames credit (docs/licenses.md), verify `Intl.DisplayNames` on target phones, tiny-country search/picker, share card PNG + Web Share, iOS install hint.
**Exit criteria:** Playwright smoke test (load → tap mood → UI updates, against local Worker); offline → online replay verified in a real browser; screen-reader pass on the list view; JS < 150 KB gz measured.

### Phase 8: Hardening

**Scope:** CI additions (bundle budget, deploy; base `pnpm check` gate exists since Phase 0.5), limit-hit behaviour, Turnstile on spikes, CSP, usage alerts at 70%, privacy page (must state the residual risks in ADR 0003: snapshot-to-snapshot differencing at low traffic; world counts at launch).
**Exit criteria:** limit-hit simulated (forced 429/503 from API) → app shows "will count shortly" and recovers; CI fails on a budget breach (mutation: bloat the bundle).

### Phase 9: Soft launch

Re-verify every free-tier figure and browser-capability claim (README "Sources"), deploy, small group, watch counters, then go public.

---

## 4. Phase report template

```
Phase N — <name>
Exit criteria: [met / not met, each listed]
Verified: ...
Mutations run: ...
NOT verified: ...
Adjacent findings (decision needed): ...
```
