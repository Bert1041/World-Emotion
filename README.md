# World Emotion

A small, warm PWA where anyone can check in with how they feel right now and watch the world, their continent and their country feel. A parody-flavoured, "you're not alone" app that is **alive**: the globe breathes, moods drift across it like weather, and every check-in visibly lands.

This README is the source of truth for **what we are building, why it is shaped this way, and what we chose not to do**. Sketches and other planning docs live in `/docs` and are referenced from here.

> Revision 4 (2026-11-07): §8.5 design direction replaced by the mood-driven Earth; reference device is a Pixel 6 Pro (ADR 0004).
>
> Revision 3. Changes from revision 2: resolved spec gaps G1–G10 from `docs/PLAN.md` (write cost of purges, 5-minute cadence, time-based smoothing, aggregator state, shrinkage chain, processed snapshot, idempotent replays, manual-country validation, unknown-country handling); closed the launch open questions (`docs/decisions/0001-launch-product-decisions.md`).
>
> Revision 2. Changes from revision 1: animation promoted to a core pillar with its own architecture (section 8); added accessibility, tiny-country tap targets, platform caveats, mood smoothing, a traffic simulator, security and licensing; build order now starts with a performance spike.

---

## 1. Product in one paragraph

Open the app, spin a hand-painted globe, tap a mood. Your check-in counts toward your country for about 6 hours, then fades. The globe shows the dominant mood of the world as living, animated "weather"; tap a continent or a country to glide in and see its mood and the breakdown behind it. Result cards are shareable ("Today the world feels stressed. You're not alone.").

**Non-goals (on purpose):** accounts, free-text posts, chat, comments, followers, feeds. Each adds moderation, privacy and cost burden a solo developer cannot carry.

---

## 2. Constraints that drive every decision

| Constraint | Consequence |
|---|---|
| Solo developer | Few moving parts. One language (TypeScript), one vendor, one deploy command. |
| Near-zero budget | Free tiers by design; the app degrades gracefully at a limit instead of falling over. |
| Viral spikes are the success case | Cost must not scale with readers. Reads come from cache; only check-ins touch the database. |
| Animation is the product's wow factor | A real engineering budget for motion: 60 fps on cheap phones, adaptive quality, never jank. |
| Anonymous, no login | No PII. Country comes from the request, never GPS. IPs are never stored. |
| Global audience, often low-end phones on slow data | Hard size and frame-time budgets (section 8.7). No heavy 3D engine by default. |
| No user-generated text | Moods are a fixed enum. Zero moderation work. |

**The core architectural idea:** reads vastly outnumber writes and everyone sees the same data. So we compute one **snapshot** of the world every few minutes, publish it as a static JSON file behind a CDN, and let a million people read the same file. The database only ever sees check-ins. All the "magic" (animation, interpolation, weather) happens **on the client**, which costs us nothing to run.

---

## 3. Architecture

```
                      READ PATH (99% of traffic, ~free)
 ┌────────────┐   GET /snapshot.json    ┌────────────────────┐
 │  PWA (SPA) │ ──────────────────────► │ CDN cache (30-60s) │
 │  Svelte +  │                         └─────────┬──────────┘
 │  canvas    │                                   │ miss
 │  engine    │                          ┌────────▼───────┐
 └─────┬──────┘                          │ R2: snapshot   │ ◄───┐ written every
       │                                 └────────────────┘     │ 1-5 min
       │   WRITE PATH (tiny)                                    │
       │   POST /checkin        ┌──────────────┐   cron   ┌─────┴──────┐
       └──────────────────────► │ Worker (API) │ ───────► │ Aggregator │
                                └──────┬───────┘          │ (Worker    │
                                       │ upsert           │  cron)     │
                                       ▼                  └─────┬──────┘
                                ┌──────────────┐  reads window    │
                                │ D1 (SQLite)  │ ◄────────────────┘
                                └──────────────┘
```

- **Web app (PWA):** static SPA with a canvas rendering engine. Renders the globe locally from bundled map data; polls `snapshot.json` every 30-60 s (with jitter); tweens smoothly between snapshots. Works offline from the last cached snapshot.
- **API Worker:** one endpoint that matters, `POST /checkin`. Validates, derives country from the request, upserts the vote. Idempotent. No other write endpoints.
- **Aggregator (scheduled Worker):** turns recent votes into a snapshot (section 5) and writes it to R2.
- **D1:** holds votes. Small, SQL, easy to migrate.
- **R2 + CDN:** hosts `snapshot.json`. Reads never invoke the API or touch D1.

**Why polling, not WebSockets:** a cached static file costs nothing under load; a live socket per user does not. "Live enough" (30-60 s) is the right promise, and **client-side tweening makes 60-second updates feel continuous**.

---

## 4. Stack

| Layer | Choice | Why (and what we rejected) |
|---|---|---|
| Language | **TypeScript everywhere** | One language, shared types between app and API. |
| Frontend shell | **Svelte 5 + Vite** | Tiny bundles, simple reactivity, built-in transitions for DOM UI. Rejected: React (heavier), SvelteKit/Next (SSR not needed). |
| Globe + effects | **d3-geo (orthographic) on layered Canvas 2D** + Natural Earth TopoJSON | Tens of KB vs. 600 KB+ for a WebGL globe lib. Hit-testing built in. Full control of a painterly look and of particles. Rejected as default: three.js / globe.gl (heavy on low-end phones). WebGL stays the documented fallback (section 8.8). |
| Motion engine | **Own small engine** (`packages/motion`): springs, tweens, easing, colour interpolation | ~2-4 KB, pure and unit-testable, zero runtime deps. Rejected: Lottie/Rive (runtime weight, designed for authored clips, not data-driven effects). Re-evaluate only if it saves real time. |
| PWA | **vite-plugin-pwa** (Workbox) | Installable, offline shell, cached last snapshot. |
| API | **Cloudflare Workers** (Hono router) | Edge latency, no servers. Country is on the request (`request.cf.country`); no geo-IP service needed. |
| Database | **Cloudflare D1** | SQLite semantics, free tier, plain `.sql` migrations. |
| Snapshot hosting | **R2** behind CDN caching | Cheap writes, no egress fees. |
| Static hosting | **Cloudflare Pages** | Same vendor, free. |
| Validation | **Zod** (shared package) | One schema for client and server. |
| Bot protection | **Cloudflare Turnstile**, only on suspicious spikes | Invisible to normal users. *Verify free-tier terms.* |
| Tests | **Vitest** (unit), **Playwright** (smoke) | Section 10. |
| CI/CD | **GitHub Actions** → `wrangler deploy` | One reproducible pipeline. |
| Packages | **pnpm workspaces** | Monorepo without extra tooling. |

**Single-vendor risk:** acceptable because logic is plain TypeScript and plain SQL. `packages/core` and `packages/motion` import nothing from Cloudflare, so moving later means rewriting thin adapters, not the product.

---

## 5. Core logic (the part worth getting right)

All of this lives in `packages/core` as **pure, unit-tested functions** with no I/O.

### 5.1 Moods are a fixed enum
Six to eight moods stored as a small integer. Adding one is a deliberate migration. Moods are told apart by **face shape and label, not colour alone**.

### 5.2 A check-in expires
A vote counts for a **6-hour window**. One active mood per device: a new check-in replaces the old one.

### 5.3 Country, continent, world
- **Country mood** = distribution of valid votes from that country in the window; headline = most common mood, full breakdown shown beside it (a 50/50 split never reads as a bland "meh").
- **Continent mood** = votes pooled across its countries (not an average of averages).
- **World mood** = all votes pooled.
- Country → continent comes from a **static mapping generated at build time** from Natural Earth. Edge cases (transcontinental countries, territories, disputed borders) are decided once in `docs/geo-decisions.md`, never computed at runtime.

### 5.4 Small samples (cold start, solved honestly)
A country with 2 votes must not speak for a nation. Use **shrinkage toward the parent**:

```
country_estimate = (n * local_distribution + k * continent_distribution) / (n + k)
```

with `k` around 10-20 (tuned later). Few votes ⇒ the country leans on its continent and is labelled "quiet here". Many votes ⇒ it speaks for itself.

The same formula applies at every level, forming a chain: **country → continent → world → uniform prior**. A continent with few votes leans on the world; a world with zero votes renders the "quiet" state rather than a fake mood.
**We do not fabricate data.** If the globe is ever seeded at launch, it is clearly labelled as a warm-up and removed as real votes arrive.

### 5.5 Smoothing and stability (new)
Raw per-minute data twitches, and a twitchy globe feels fake.
- **Temporal smoothing:** each snapshot blends with the previous one, done in the aggregator so every client sees the same thing. Smoothing is defined as a **half-life in minutes**, with the blend weight derived from the time since the last run (`alpha = 1 - 2^(-dt / halfLife)`), so changing the aggregation cadence does not change how the globe feels.
- **Where the state lives:** all state carried between runs (unrounded distributions for every region, including those below the privacy floor, plus current headline, challenger and streak) lives in a private `aggregator-state.json` in R2. The public snapshot is output only and is never read back, because it is rounded and omits small regions.
- **Headline hysteresis:** the headline mood only flips when the new leader is ahead by a margin (e.g. 3 percentage points) or has led for two consecutive snapshots. Prevents flip-flopping between two close moods.
- Both are pure functions with tests (ties, near-ties, sudden spikes, a single noisy country).

### 5.6 Abuse resistance
- Device key: random ID created on first visit, kept locally. Not an identity, just a "one active vote" handle. The server stores only a **salted hash**.
- Rate limit by a hash of the IP using a **daily-rotating salt** (throttle without storing IPs).
- Changing country manually is allowed but rate-limited (country-hopping is the obvious troll move; shrinkage limits the damage).
- **A vote counts for a country only where it is cast from** (decided 2026-11-09). The API compares the chosen country with `request.cf.country`, at request time, without storing the IP: if they match, the vote counts for the country, its continent and the world; if not (someone in Canada picking the United States, a traveller), or if the connection country is unknown, it counts for the **world only**. This stops people outside a country from setting its mood; GPS was rejected (a permission prompt for a mood app). The app says so when the two differ, rather than silently discounting.
- Country detection is "good enough", not truth: VPNs will fool it. Accepted for a parody app.
- `request.cf.country` can return non-countries (`XX` unknown, `T1` Tor). These are treated as unknown: the user is asked to pick a country, otherwise the vote counts toward the world only.
- A manually chosen country is validated against the generated ISO list from `packages/geo-data`. Where rate-limit counters live (Workers Rate Limiting binding vs. a D1 table, which costs writes) is decided in the API phase; verify free-plan availability first.
- Turnstile challenge only when a suspicious spike is detected.

---

## 6. Data model (starting point)

```sql
-- migrations/0001_init.sql
CREATE TABLE votes (
  voter_hash  TEXT PRIMARY KEY,      -- salted hash of device key; one row per device
  country     TEXT NOT NULL,         -- ISO 3166-1 alpha-2, from the request
  mood        INTEGER NOT NULL,      -- enum 0..N
  created_at  INTEGER NOT NULL,      -- unix seconds, server time
  last_checkin_id TEXT NOT NULL      -- idempotency key of the last accepted check-in
);
CREATE INDEX idx_votes_window ON votes (created_at, country, mood);
```

**`POST /checkin`** takes `{ mood, country? }` plus an idempotency key, so retries (offline queue, flaky networks) never double count. If the key matches `last_checkin_id`, the server returns success **without writing**, so a replay neither refreshes `created_at` (which would stretch the window) nor spends write budget. The offline queue keeps **only the latest** check-in per device, so stale replays cannot overwrite a newer mood.

**Snapshot (`snapshot.json`)** is versioned and small (a few KB gzipped):
```
{ "v": 1, "generatedAt": ..., "windowSeconds": 21600,
  "world":      { "n": ..., "dist": [..], "h": 1 },
  "continents": { "NA": { "n": ..., "dist": [..], "h": 1 }, ... },
  "countries":  { "CA": { "n": ..., "dist": [..], "h": 0 }, ... } }
```
Distributions are arrays indexed by mood id and are **final**: already shrunk and smoothed by the aggregator, so clients never redo the maths and every client agrees. `n` is the **raw** vote count, always included so the UI can show "quiet here". The client rejects snapshot versions it doesn't understand and keeps the last good one.

`h` is the headline mood **after hysteresis**, computed once in the aggregator so every client shows the same word (ADR 0003). **Privacy floor:** countries and continents with fewer than 5 votes are omitted; the client falls back to the parent and shows "quiet here". Because a parent minus its published children would still reveal the hidden rest, **complementary suppression** also hides the smallest published sibling whenever that remainder would be 1–4 votes. Residual risks (snapshot-to-snapshot differencing at low traffic) are in ADR 0003 and go on the privacy page.

**Retention:** purge votes older than the window plus a small buffer on each aggregation run. Deletes count as rows written, so purging is part of the write budget (section 7). No history at launch (also a privacy feature).

---

## 7. Free-tier budget (check before you scale)

Limits read from Cloudflare's published docs on 2026-11-05. **They change. Re-verify before launch.**

| Resource (free plan) | Limit | How we stay under it |
|---|---|---|
| Worker requests | 100,000 / day | Reads bypass Workers via CDN-cached R2 file. Only check-ins and cache misses invoke a Worker. |
| Worker CPU time | 10 ms / request | `POST /checkin` does one validated upsert. Keep it boring. |
| Cron triggers | 5 / account | We need one. |
| D1 rows written | 100,000 / day | ~4 row writes over a vote's life: insert (row + index) and purge (row + index); a re-vote updates in place instead ⇒ roughly **25k new check-ins/day** before the ceiling. *Estimate; measured with `meta.rows_written` in the API phase.* |
| D1 rows read | 5,000,000 / day | See aggregation note below. |
| D1 storage | 5 GB | Votes are tiny and purged. |
| R2 | 10 GB-month, 1M Class A ops/month | One snapshot write per minute is ~43k/month. |

**At the limit:** the API errors once a daily cap is hit. The app handles it quietly: queue the check-in locally, show "Saved, will count shortly", keep showing the last snapshot. A viral day that exhausts the free tier should look like a slightly delayed globe, not a broken app. A paid plan is the escape hatch.

**Alerts:** set Cloudflare usage notifications at ~70% of the daily caps so you hear about it before users do.

### Aggregation cost: the one thing that will bite
Scanning every vote in the window on each run multiplies rows-read by runs per day. Two stages:
1. **Stage 1 (launch):** aggregate every **5 minutes** from `votes` using the covering index. At 2 minutes the read cap binds first: 720 runs/day × 10k votes in window = 7.2M rows read, over the 5M limit (break-even ≈ 6.9k votes). At 5 minutes, 288 runs × 10k ≈ 2.9M.
2. **Stage 2 (if viral):** time-bucketed counters (`bucket_counts(bucket_ts, country, mood, n)`, 15-minute buckets). Check-ins increment the current bucket; the aggregator sums the last 24. Cost then scales with countries, not votes.

Trigger: move to Stage 2 when daily rows-read passes ~50% of the limit.

**The one real expense:** a domain (~$10/year), which lets the CDN cache the snapshot in front of R2 so reads don't invoke a Worker.

---

## 8. Animation and experience (a core pillar)

Animation is what makes this go viral, so it gets the same rigour as the backend. The rule: **it must look expensive and cost nothing**, on a cheap phone.

### 8.1 Rendering architecture

Four stacked layers, each redrawn only when it needs to be:

| Layer | Tech | Redraw policy |
|---|---|---|
| 1. Background | CSS (paper grain, vignette) | Static. |
| 2. Globe base | Canvas 2D: ocean, land, country fills, borders | **Dirty-flagged**: only when rotation, zoom, selection or colour tween changes. |
| 3. FX | Canvas 2D: particles, ripples, glow | Every frame while visible; pooled and batched. |
| 4. UI | DOM (Svelte) | Compositor-only CSS (`transform`, `opacity`). Never animate layout properties. |

- **One `requestAnimationFrame` loop**, delta-time based, with a **fixed-step** update for springs so behaviour is identical on 60 Hz and 120 Hz screens.
- **Pause** completely when the tab is hidden (`visibilitychange`); drop to a cheap ambient mode when idle.
- **Zero allocation in the frame loop:** particles in typed arrays (struct-of-arrays), object pools, no per-frame closures or array spreads.
- **Projection culling:** skip countries on the far hemisphere using precomputed bounding caps.
- **Level of detail:** low-resolution geometry while dragging, higher resolution at rest and when zoomed into a region (lazy-loaded).
- **DPR cap:** render at `min(devicePixelRatio, 2)` on capable devices, 1.5 or lower on weak ones.

### 8.2 The signature animations

1. **Idle life:** slow rotation, a soft "breathing" glow in the world's dominant mood colour, drifting particles.
2. **Drag and spin:** inertial drag with friction, spring settle, rubber-band at zoom limits.
3. **Mood weather (data-driven):** each region emits a particle system for its dominant mood, intensity scaled by its lead and its sample size (quiet regions are faint):
   - happy: rising sparks / fireflies
   - calm: slow drifting mist and dust motes
   - excited: quick bursts and sparkle
   - stressed: trembling edges, jittery static
   - sad: soft falling rain streaks
   - angry: embers and heat shimmer
4. **World mood changes:** colours interpolate in a perceptual space (OKLab) over ~1.2 s; the headline word morphs (letter roll or crossfade); the breakdown bar flows to its new shape. Nothing ever snaps.
5. **Check-in moment:** your mood face pops with a spring, drops onto your country, a **ripple** expands outward across the globe, counters tick up, haptic tick where supported. This is the dopamine hit; polish it first.
6. **Drill-down glide:** tapping a region eases the camera along a great-circle path (rotation interpolation) while zooming; other regions dim; breakdown bars fill in sequence.
7. **Day/night band:** a subtle terminator shadow sweeping the globe with real time (a few lines of solar-position maths, no library). It quietly reinforces "this is happening right now".
8. **Shareable motion (later):** capture a short looping clip of the globe with `canvas.captureStream` + `MediaRecorder`. Static PNG first; video support varies by browser, so treat it as an enhancement.

### 8.3 Motion design tokens
One file defines durations, easings and spring constants (`fast 120ms`, `base 240ms`, `slow 600ms`, `glide 1200ms`, plus 2-3 spring presets). Every animation uses tokens, never ad-hoc numbers, so the whole feel can be re-tuned in minutes and stays consistent.

### 8.4 Adaptive quality
- Measure median frame time over the first ~60 frames, assign a **tier** (High / Medium / Low) controlling particle counts, grain, glow, map detail and DPR.
- **Auto-downgrade** if frames drop mid-session; never auto-upgrade (it causes visible flicker).
- Visible in-app "Calm motion" toggle, and **`prefers-reduced-motion` is honoured**: static globe, crossfades only, no particles or rotation.
- Battery saver / low-power hints (where exposed) also push the tier down.

### 8.5 Design direction: the Earth follows the world's mood
*Revised 2026-11-07 (user direction, prototype approved; replaces "warm paper globe"). Detail: `docs/design/phase-3b-look-and-feel.md`.*
- **One Earth per world mood,** driven by the snapshot's world headline `h` (which has hysteresis, so the theme never flickers): happy = Overgrown, calm = Waterworld, excited = City lights, stressed = Simulation, sad = Ice age, angry = Ruined. A change cross-fades in OKLab over ~2.5 s. Themes are data (`apps/web/src/engine/themes.ts`).
- **Regions keep their own mood weather** on top (fireflies, mist, sparkle bursts, static, rain, embers).
- **Mood colours are constant across themes** (a colour never changes meaning); moods are always named in the UI, never colour alone.
- **Layout rule: text never sits on the Earth.** The globe is fitted into the space the UI leaves free; zooming fits the continent beside the card (landscape) or above it (portrait). Enforced by browser tests at 11 viewports (`apps/web/e2e/layout.spec.ts`).
- **Type scales with the screen** (fluid root size, UI in rem).
- **Sound (optional, off by default):** small compressed ambient loops per dominant mood; subtle tick and chime on check-in. Browsers block autoplay, so audio only starts after a user gesture.
- Design tokens (colours, type, spacing) in one CSS variables file.

### 8.6 Interaction details that are easy to miss
- **Tiny and thin countries** (Singapore, Vatican, islands) are impossible to tap on a globe. Provide a search box and a list picker, plus a magnified tap radius that snaps to the nearest small country.
- **Accessibility:** a canvas is invisible to screen readers. Ship an accessible **list/table view of the same snapshot**, full keyboard navigation for check-in and region selection, visible focus states, labelled controls.
- **Platform caveats:** iOS has no `beforeinstallprompt` (show a manual "Add to Home Screen" hint), no `navigator.vibrate` (haptics are Android-only), stricter audio autoplay, and no Background Sync. Retry the offline check-in queue on app foreground instead.
- **Frame-rate honesty:** 120 Hz devices and 60 Hz devices must feel the same, hence fixed-step physics.

### 8.7 Performance budgets
- Initial JS **< 150 KB gzipped** (map data excluded, lazy-loaded). Enforced in CI.
- **Frame budget:** under ~8 ms of script per frame on a mid-range Android, leaving headroom for the browser to paint.
- Sustained **60 fps drag** on the reference low-end device, with the Low tier as the floor.
- **Test on a real cheap Android early.** Emulators and desktop Chrome lie about this. *Decision (ADR 0004): the reference device is a Pixel 6 Pro (flagship); no low-end phone is tested before launch. Risk accepted.*
- Dev-only overlay (toggle with a key) shows frame time, particle count, tier and DPR.

### 8.8 Risk: is Canvas 2D enough? (decide with evidence)
This is the biggest technical assumption, so we test it **first** (section 11, step 3). Go/no-go gate: 60 fps drag with idle weather particles on the reference low-end phone.
- **Outcome (2026-11-07): GO** on the Pixel 6 Pro after the second fallback (lower map detail while moving); OffscreenCanvas was skipped because particles cost ~0.3 ms. Numbers and caveats: `docs/decisions/0005-globe-go-no-go.md`.
- **If it passes:** proceed as designed.
- **If it fails:** first move FX to an `OffscreenCanvas` worker and reduce map detail while dragging; if still short, move the globe to a small WebGL renderer (e.g. regl) while keeping the same engine, tokens and data. The architecture above is deliberately layered so this swap touches only the rendering layer.

### 8.9 Sharing
Generate the share card **on the client** (Canvas → PNG) and use the Web Share API. Free, no server rendering. Static Open Graph tags at launch; dynamic per-result previews are a later, optional upgrade.

---

## 9. Security, privacy and licensing

- **Privacy:** no accounts, no IPs stored, salted hashes only, short retention, plain-language privacy page. Emotional data is sensitive in perception even when anonymous; say clearly what is and isn't stored. Confirm whether the local device key needs consent wording in the regions you launch in.
- **Secrets:** hashing salts and keys live in Worker secrets, never in the repo. Rotate the IP-hash salt daily.
- **Web security basics:** strict CORS on the API, a Content Security Policy, input validation at every boundary.
- **Licensing:** Natural Earth is public domain; still record it. Track licences for fonts, textures and any audio (use CC0 or self-made) in `docs/licenses.md`.

---

## 10. Quality bar (engineered, not vibe-coded)

- **Core logic is pure and tested:** shrinkage, pooling, smoothing, hysteresis, window expiry, continent mapping, plus motion maths (springs, easing, OKLab interpolation, great-circle rotation, solar position). Edge cases covered: zero votes, one vote, ties, a single troll country.
- **Schemas at the boundary:** every request parsed with Zod.
- **Migrations only:** numbered `.sql` files, never ad-hoc schema edits.
- **Traffic simulator:** `tools/simulate` generates realistic fake check-ins (spikes, regional waves, trolls) against a local Worker, so animation, aggregation and limit-handling can be tested without real users.
- **One smoke test:** Playwright loads the app, taps a mood, sees the UI update against a local Worker.
- **Observability without invasive tracking:** Workers logs and Cloudflare analytics. No third-party trackers.
- **Decision records:** any non-obvious choice gets a short note in `docs/decisions/` (context, decision, alternatives, consequences).
- **Boring dependencies:** each one justifies itself. Prefer the platform.

---

## 11. Build order

1. **Core first:** `packages/core` with tests (moods, window, shrinkage, smoothing, hysteresis). No UI, no network.
2. **Geo data:** generate the country→continent map and trimmed TopoJSON; write down edge-case decisions.
3. **Globe performance spike (go/no-go):** d3-geo canvas globe with drag/inertia, tap-to-select, idle weather particles, driven by a fake snapshot. Test on a real low-end Android. Apply the gate in 8.8 **before building anything else on top**.
4. **Motion engine:** `packages/motion` (springs, tokens, OKLab tweening) with tests; wire the signature animations, check-in moment first.
5. **API:** `POST /checkin` + D1 migration, tested locally with `wrangler dev` and the simulator.
6. **Aggregator + snapshot:** cron writes `snapshot.json` to R2; app polls it and tweens between snapshots.
7. **PWA, offline queue, accessibility view, share card.**
8. **Hardening:** rate limiting, limit-hit behaviour, performance budget in CI, usage alerts.
9. **Soft launch** to a small group, watch the free-tier counters, then go public.

---

## 12. Repository layout

```
world-emotion/
├─ apps/
│  ├─ web/                 # Svelte + Vite PWA
│  │  └─ src/engine/       # render loop, layers, particle systems, quality tiers
│  └─ api/                 # Worker: /checkin + scheduled aggregator
├─ packages/
│  ├─ core/                # pure logic: moods, windows, shrinkage, smoothing (no I/O)
│  ├─ motion/              # pure motion maths + tokens: springs, easing, colour, rotation
│  ├─ shared/              # Zod schemas, types, constants
│  └─ geo-data/            # build script + generated country→continent map
├─ tools/
│  └─ simulate/            # fake traffic generator for local testing
├─ migrations/             # D1 .sql migrations
├─ docs/
│  ├─ sketches/            # design sketches from planning
│  ├─ decisions/           # short decision records
│  ├─ geo-decisions.md
│  └─ licenses.md
├─ .github/workflows/      # CI: lint, test, budget check, deploy
├─ package.json
└─ pnpm-workspace.yaml
```

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Canvas 2D too slow on low-end phones | Spike first with a go/no-go gate; OffscreenCanvas, then WebGL fallback; adaptive tiers. |
| Animation jank or battery drain | Dirty-flagged layers, pooled particles, pause when hidden, tiers, reduced-motion support. |
| Free-tier limit hit on a viral day | Local check-in queue, stale-snapshot fallback, Stage 2 counters, usage alerts, paid plan as escape hatch. |
| Trolls skew a small country | Shrinkage, hysteresis, rate limits, Turnstile on spikes. |
| Empty globe feels dead at launch | "Quiet here" state leaning on the continent; labelled warm-up only if needed. |
| Geo edge cases cause arguments | Decide once, document, make the map data-driven. |
| Cloudflare lock-in | Pure `core` and `motion` packages; thin adapters. |
| Emotional-data privacy perception | No accounts, no IPs stored, short retention, plain-language privacy page. |
| iOS PWA limitations | Manual install hint, foreground retry, no reliance on vibration or background sync. |

---

## 14. Open questions (decide before building)

**Resolved** (see `docs/decisions/0001-launch-product-decisions.md`): six moods (happy, calm, excited, stressed, sad, angry); fixed 6-hour window; world mood is a pure pool of check-ins, stated openly in the app.

**Still open:**
- ~~Which reference low-end phone do we test on?~~ Pixel 6 Pro (ADR 0004). Pass bar: see `docs/design/phase-3-globe-spike.md`.
- Is sound in scope for launch, or a later polish?
- Domain name and brand name.
- Any daily "world mood" history, and if so how do we keep it anonymous?

---

## Sources and verification

Free-tier figures were taken from Cloudflare's documentation and plan pages on 2026-11-05:
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare plans](https://www.cloudflare.com/plans.md)

**Re-verify before launch:** all limits above, Turnstile free-tier terms, and whether R2-via-CDN reads bypass Worker request counts on your final setup. Browser capability claims (OffscreenCanvas, MediaRecorder, Web Share with files, haptics) should be re-checked against current browser support when you reach those steps.
