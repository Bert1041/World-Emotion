# Phase 1 design: `packages/core` + `packages/shared`

Status: **implemented** (branch `phase-1/core`). P1 approved (headline `h` in snapshot); P2(a) approved (floor of 5); shown insufficient against differencing, so P3 = A added complementary suppression ([ADR 0003](../decisions/0003-snapshot-headline-and-privacy-floor.md)).

Deviation from §3 as first drafted: smoothing reads the previous **private state**, not the published snapshot (the snapshot is rounded and omits small regions, so smoothing from it would jump when a region crosses the floor).

The aggregator (Phase 6) will be a thin I/O shell around one pure function defined here. Every client renders exactly what that function outputs; no client re-derives maths.

---

## 1. Package boundaries

| Package | Holds | May import |
|---|---|---|
| `shared` | Mood enum + labels, continent codes, tunable constants, Zod schemas (check-in request, snapshot), inferred types | `zod` only |
| `core` | Pure functions: window, pooling, shrinkage, smoothing, hysteresis, `buildSnapshot` | `shared` only |

`core` purity is **enforced by lint, not convention**: Biome `noRestrictedImports` bans `node:*` and `cloudflare:*`; `noRestrictedGlobals` bans `fetch`, `Date`, `crypto`, `setTimeout`, `setInterval`, `localStorage`. Time is always passed in as `now` (unix seconds). This makes every function deterministic and testable.

## 2. Domain constants (`shared`)

```ts
Mood: happy=0, calm=1, excited=2, stressed=3, sad=4, angry=5   // order is a migration (ADR 0001)
Continent: AF, AN, AS, EU, NA, OC, SA                           // country mapping arrives in Phase 2
WINDOW_SECONDS          = 21_600   // 6 h
SHRINK_K                = { country: 15, continent: 15, world: 15 }
SMOOTHING_HALF_LIFE_SEC = 180      // 3 min → alpha ≈ 0.685 at 5-min cadence (≈ README's 0.7)
HYSTERESIS_MARGIN       = 0.03     // 3 percentage points
HYSTERESIS_STREAK       = 2        // consecutive snapshots
QUIET_BELOW_N           = k        // a region is "quiet" when local weight < 50%, i.e. n < k
DIST_DECIMALS           = 4
```
All tunables live in one file and get retuned with the simulator in Phases 5–6.

## 3. Algorithms (exact semantics)

**Window.** A vote is active iff `now - windowSeconds < createdAt <= now`. A vote dated in the future (clock skew) is excluded.

**Pooling.** Input: `counts: {country, mood, n}[]` (what the SQL `GROUP BY` returns) plus a `countryToContinent` map (injected; Phase 2 generates it). Country counts are summed into continent and world counts. A country **not in the map** (`XX`, `T1`, anything unknown) counts toward **world only** (README G9).

**Shrinkage**, computed top-down so each level leans on its already-shrunk parent:
```
world     = shrink(worldCounts,     uniform,   k.world)
continent = shrink(continentCounts, world,     k.continent)
country   = shrink(countryCounts,   continent, k.country)
shrink(c, parent, k) = (c + k * parent) / (n + k)   // c = raw counts vector, n = sum(c)
```
n = 0 ⇒ exactly the parent. A country whose continent is unknown would have no parent; impossible by construction (unknown → world only).

**Smoothing** (on shrunk distributions, per region):
```
alpha = 1 - 2^(-dt / halfLife),  dt = now - previous.generatedAt
smoothed = alpha * current + (1 - alpha) * previous
```
- No previous snapshot, or region absent from it ⇒ `alpha = 1`.
- `dt <= 0` (duplicate or clock-skewed run) ⇒ return the previous snapshot unchanged; never divide time backwards.
- Long gap (cron outage) ⇒ alpha → 1; fresh data wins, which is correct.

**Headline hysteresis** (on smoothed distributions; state per region `{headline, challenger, streak}`):
1. `leader` = argmax. Exact ties: keep the current headline if it is among the tied; else lowest mood id (deterministic).
2. No current headline ⇒ headline = leader.
3. `leader == headline` ⇒ reset challenger and streak.
4. Otherwise, if `dist[leader] - dist[headline] >= margin` ⇒ flip now.
5. Otherwise, count consecutive leads by the *same* challenger; at `streak >= HYSTERESIS_STREAK` ⇒ flip. A different challenger restarts the count at 1.

**Rounding.** Distributions are rounded to 4 decimals at the very end; the schema accepts sums within `1 ± 0.001`.

**Pipeline.** One pure entry point:
```ts
buildSnapshot({ counts, countryToContinent, now, previous?, previousState?, config })
  → { snapshot, state }   // snapshot is public (R2), state is private (README G4)
```

## 4. Schemas (`shared`, Zod)

- **Check-in request:** `{ mood: int 0–5, country?: /^[A-Z]{2}$/, checkinId: uuid }`. Membership in the real country list is cross-checked in Phase 2 (already an exit criterion there).
- **Snapshot v1:** `{ v: 1, generatedAt, windowSeconds, world, continents, countries }`, each region `{ n, dist: number[6], h }`. `parseSnapshot` rejects unknown `v` so the client keeps its last good one.

## 5. Test plan

Table-driven unit tests **plus property tests** with `fast-check` (dev-only dependency, justified below). Every behavioural test is mutation-checked; the phase report lists the mutations.

| Area | Cases |
|---|---|
| Window | boundary exactly at `now - window` (excluded), at `now` (included), future-dated (excluded) |
| Pooling | unknown country → world only; continent = sum of its countries (not an average of averages) |
| Shrinkage | n=0 ⇒ parent; n=1 with k=15; n ≫ k ⇒ ≈ local; **property:** output sums to 1 and every component lies between local and parent |
| Smoothing | first run alpha=1; dt≤0 returns previous; same feel across cadences (two 150 s steps ≈ one 300 s step, analytically); **property:** output stays a valid distribution |
| Hysteresis | exact tie, near-tie under margin (no flip), lead ≥ margin (flip), two consecutive leads (flip), alternating challengers (no flip), sudden spike |
| Pipeline | zero votes anywhere; single troll country flooding one mood (continent moves, world barely); deterministic: same input ⇒ byte-identical JSON |
| Schemas | valid / invalid check-ins; snapshot v2 rejected; dist of wrong length rejected |

**Why `fast-check`:** the claims that matter most ("always a valid distribution", "always between local and parent") are about *all* inputs, and hand-picked examples are a sample, not the set. Dev-only, zero runtime cost. Pinned under the 14-day rule.

## 6. Decisions needed

**P1. Headline in the snapshot (schema change to README §6).** Hysteresis must run in the aggregator so every client agrees, which means the snapshot has to carry the headline (`h`). The README's snapshot shape has no such field. *Recommend: add `h` per region.*

**P2. Privacy floor for tiny countries.** Publishing a country's distribution together with its raw `n` and its continent's distribution lets anyone recover the votes exactly. Verified: with n = 1 the single voter's mood comes back as `[0,0,0,1,0,0]`. Votes carry no identity, but "the only person checking in from Liechtenstein is sad" is still a leak from an app that promises privacy. Options:
- **(a) Recommend:** omit countries with `n < 5` from the snapshot entirely; the client shows the continent with "quiet here". Simple and closes the leak for the smallest samples.
- (b) Publish all countries but bucket `n` ("<5", "5–20", …). Harder to reason about; partial protection only.
- (c) Accept the leak for a parody app and state it on the privacy page.
