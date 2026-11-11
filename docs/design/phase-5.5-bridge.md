# Phase 5.5 design: the bridge (audit fixes before Phase 6)

Status: **approved** (2026-11-10): B1 viewed region, B3 journal in the bridge, B5 drop the label, B6 rename
the two themes; B2 and B4 as recommended unless objected to before PR B. Source: `docs/audit-2026-11-10.md`.
Branches from `main` after PR #9 (Phase 5) merges. Two PRs, each a sign-off gate (§3).

## 1. Why a bridge, and what it must not become

Phase 6 wires the app to the server. The audit found that the client it would be wired into has no
seam for a data source, no quiet state, no failure state, no second act after the check-in, and a
first-run country guess that is wrong for most English installs. Wiring real data into that shape
would bake every one of those into the first end-to-end run and make them Phase 7's problem.

The bridge fixes the shape, not the features that need the server. Rule for scope: **a bridge item
needs no API, no aggregator and no deploy**; everything that does moves to the Phase 6 scope in §5.

## 2. Where comparable products failed, and the counter in this plan

| Failure | Who | Counter here |
|---|---|---|
| **Novelty with no second act**: one visit, a screenshot, gone | most "world mood" / globe novelties | The result line (R1): after the tap you see yourself among others and against your country, from the same snapshot, every time. The journal (R2): the app accumulates something that is yours. |
| **The collective gets brigaded** and the brigade becomes the story | polls, r/place-style canvases, country "rankings" | Country counts only where cast from (Phase 5, done). Turnstile unconditional on the first check-in per device, moved up from "if we notice" to a launch gate (Phase 8 scope, §5). No country leaderboard, ever. |
| **Mood apps become guilt machines**: streaks, reminders, badges | consumer mood trackers | No streaks, no badges, no notifications. The journal counts, it never scolds. |
| **The art project goes stale**: nothing changed since last time | sentiment dashboards, passive scrapes | Theme follows the viewed region (T1), so zooming is travelling. A daily artefact (R3, Phase 7) gives the world a reason to look at the same hour. |
| **Dead on arrival**: an empty map at launch, or a faked full one | every cold-start product | An honest quiet state that is designed, not accidental (E3): the world count is the hero until regions light up; small countries say up front that they show their continent (SC). Launch plan in Phase 9 targets one community that fills 5+ votes per country of interest in the first hour. |
| **Tone-deaf on a bad day** | brands with cheeky copy during crises | Theme names reviewed (U7); whichever option is chosen is a decision record, not an accident. |
| **"It doesn't know where I am"** on the first screen | anything that guesses location | Place-first first run and a visible pin before the tap (J2). |

## 3. Scope: two PRs

### PR A: `phase-5.5a/foundations` (engineering + states)

| Item | What | Exit criterion |
|---|---|---|
| **E3** quiet world (P0) | Header shows the quiet state when `world.n < publishMinN`; `view.worldMood = null`; the theme takes the quiet Earth (B4). Copy: "The world is quiet" / "{count} so far" (i18n ×4). | e2e: snapshot with `n = 0` and `n = 4` shows the quiet headline and no mood word; `n = 5` shows a mood. Mutation: remove the branch → fails. |
| **E2** `SnapshotSource` | `interface SnapshotSource { start(onSnapshot): () => void; checkIn?(country, mood): void }`. `DemoSource` wraps `SnapshotSim` and owns the 2 s / 20 s timers and `autoCycle`. `frame()` and `checkIn()` know only the interface. | `grep SnapshotSim apps/web/src/main.ts` is empty. All e2e green. Phase 6's `PolledSource` is a new file, not an edit to `main.ts`. |
| **E1** split `main.ts` | `engine/input.ts` (pointers, wheel, velocity → camera calls), `engine/fit.ts` (measureLayout, fitFrame, anchor), `engine/regions.ts` (snapshot → fills, card model, weather, hit test), `checkin/moment.ts` (pin, flight, ripple, landing), `config.ts` (URL params), `bench/hooks.ts` (the always-on test hooks) and `bench/harness.ts` (`verifyRender`, `run`, loaded only with `?bench=1` via dynamic import). `main.ts` becomes composition + frame loop. *As built (2026-11-10): 511 lines, not the 350 estimated. What remains is wiring and the frame loop; moving the loop into a class would relocate the coupling, not remove it.* | `main.ts` holds no gesture, layout-fitting, snapshot-to-screen, check-in, URL-parsing or bench code (a grep for each module's function names is empty) and is ≤ 520 lines. Unit tests for `releaseVelocity`, `hitCountry`, `regionOf`/`clarity`/`panelModel`, `parseSavedPin`, `readConfig`, `framePoints`/`fitFrameIn`; each mutation-checked. Bundle: the harness is its own chunk and the budget script fails if it (or map data) reaches the initial download. Bench runner still works (`tools/bench --device=desktop` smoke). |
| **E4** loading + error states | A `view.status: "loading" \| "ready" \| "failed"`. Loading: a dim disc where the globe will be, faces disabled with the prompt greyed. Failed: one sentence + "Try again" (reloads). `start()` wrapped. | Real Chrome: delay the map import → disc visible; fail it → message and button; retry works. Mutation: remove the catch → test fails. |
| **E8** early tap guard | `if (!lods) return` in the hit path. | Delayed-import e2e taps during load: no page error. |
| **E6** one definition of landscape | Media query strings exported from `engine/breakpoints.ts`; `index.html` CSS reads the same values via a build-time replace (Vite `define`) or a `<style>` written from the module. | A test asserts the CSS and the TS strings are identical. |
| **U3, U4** targets and labels | `.link` min hit area 24 px (padding, negative margin); face labels 0.78rem. | Layout e2e at 11 viewports still passes (no text on the Earth). |
| **U6** country-tap hint | On first zoom per device: "Tap a country" under the back button for 4 s, `localStorage` flag. | e2e: shown once, not twice. |
| **SC** small-country copy | When `view.checkin.country` has no entry in `snapshot.countries`: bar footer says "Small countries show their continent until 5 people check in" (i18n ×4). | e2e with a sub-floor country selected. |
| **U1** theme label | Per B5. | i18n test (keys present ×4). |

### PR B: `phase-5.5b/second-act` (product, client-only, demo-driven)

Rule for everything in this PR (adopted 2026-11-10): **genuinely usable, never a static visual pretending.** The result line and the journal show real numbers from the snapshot and real entries from the device from the first commit; no placeholder text ships.

| Item | What | Exit criterion |
|---|---|---|
| **R1** result line | After `landed()`, the chip becomes two lines: *"You feel stressed · change"* and *"with {n_mood} others · {Country} feels {mood}"* (world line when the country is below the floor or unknown: *"with {n} others in the world"*). Numbers from `dist × n` of the snapshot region; updates on every snapshot. Design doc for the copy ×4 languages with the gender/plural notes, as in Phase 4.5. | e2e: after check-in, the line shows numbers consistent with the card's breakdown; changes when `__bench.aggregate()` moves the data. Counts never go below 1 ("with 0 others" is impossible: you are counted). Mutation: break `dist × n` → fails. |
| **J2** place-first first run | Before the first check-in on a device: the place badge moves **above** the faces, reads *"Checking in from {Country} · not you?"*, and the globe loads facing the pin (B2). After the first check-in it returns to the footer. `guessCountry` unchanged (the server corrects it in Phase 6). | e2e: first visit shows the badge on top with the pin on the near side; second visit shows the footer form. Phase 6 adds the `counted: "world"` re-count path to this component. |
| **T1** theme per viewed region | Per B1. If (a): `mixer.setTarget(focus === null ? world.h : continents[focus].h)` on enter/leave/snapshot, with the existing 2.5 s cross-fade. | e2e: zoom into a continent whose `h` differs from the world's → `view.themeId` changes; back → returns. The `#theme-name` follows. |
| **R2** on-device journal | `localStorage` ring of the last 30 check-ins `{mood, at, country}` (never sent anywhere; stated in the privacy copy). Shown as a strip of small faces in the chip state, *"Your week"*, oldest left. One entry per calendar day keeps the last mood of that day. Clear-all link. | Unit tests for the ring (day collapsing, cap, corrupt storage). e2e: strip appears after the second day (simulate by seeding storage). Mutation: break day collapsing → fails. |
| **U2** particles as weather | Pre-rendered soft sprite per mood (`OffscreenCanvas` or hidden canvas, radial alpha), `drawImage` instead of `rect`; spawn culled when the particle's lon/lat is not inside its country's bounding box; alpha reduced 20 %. | Pixel 6 Pro bench: drag p95 frame time within 10 % of the Phase 4 gate numbers (`docs/bench`). Screenshot diff: no particles beyond 2° of a coastline at zoom 1 in three poses. *As built (2026-11-11): spawn points are sampled inside each country (engine/land.ts; all 237 checked on the real 50m map) and spread in idle time after first paint, since sampling takes ~0.25 s on a laptop; weather is also weighted by land area (sqrt(a/(a+0.005 sr))), because per-country weighting put 42 % of all weather on countries under ~20,000 km², dots in the sea (now 8 %). The 'within 2° of a coastline' screenshot check became a stronger browser test: every particle anchor inside a country, on the live globe. Static stays square and rain stays streaks, on purpose. Desktop gate: frame p95 within 3 % of the day before; the particle layer 0.1 → 0.6 ms at 4× CPU. **Pixel not yet re-benched (phone not connected).***|
| **M1** press feedback everywhere (added 2026-11-10) | Every control reacts when pressed, as the faces already do: back, language button and its menu items, "move", "change", "cancel", search results, retry, the card handle. One shared rule (`:active` scale/dim on the motion tokens, `--fast`); nothing under reduced motion except a colour change. | e2e: for each control in a listed set, the computed style while the pointer is down differs from at rest; the list is asserted against every `button`/`a` in the DOM, so a new control without feedback fails. Mutation: remove the rule → fails. |
| **M2** faces that react (added 2026-11-10) | The six faces are the app's only characters. Hover or touch: a small bounce on the motion engine's spring (compositor-only `scale`/`translate`). After check-in the chip shows your face beside "You feel stressed", not the word alone. No separate mascot. Reduced motion: no bounce; the chip face still shows. | e2e: the chip contains the face for the mood picked, and it changes with "change"; hovering a face moves it and it settles back; under reduced motion it does not move. Layout test still passes at 11 viewports (the bar's height must not change). Mutations: wrong face in the chip; bounce under reduced motion. |

### Out of both PRs (and why)
- A separate **mascot** character (considered 2026-11-10, from another project's motion brief): it would need designing, animating and translating, and it competes with the globe. The faces do that job (M2).
- **E5** persist your own vote: belongs with the device key (Phase 6).
- **E7** Turnstile: Phase 8 as planned, but the PLAN entry changes to *unconditional on first check-in* and becomes a launch gate.
- **R3** daily artefact: needs the aggregator (Phase 7, after the share card).
- **A11y list view**: Phase 7, promoted to launch gate.
- The wrong-country **re-count** on `counted: "world"`: needs the response (Phase 6).

## 4. Order inside the bridge
PR A first, in this order: E2 → E1 → E3 → E4/E8 → the small CSS items. E2 before E1 because the split
is easier once the demo timers have left `main.ts`. PR B starts after PR A merges, on top of it.

## 5. Changes to later phases (PLAN.md edits in PR A)
- **Phase 6** gains: `PolledSource` implements the Phase 5.5 interface; E5 (persist the vote with the
  device key); the `counted: "world"` re-count path in the J2 component; the result line switches from
  demo to real data with no code change (acceptance test for the seam).
- **Phase 7** gains: R3 daily artefact after the share card; the list view becomes a launch gate.
- **Phase 8**: Turnstile unconditional on the first check-in per device; launch gate.
- **Phase 9**: a named launch community and a cold-start checklist (world count as hero; quiet regions
  expected; the first 5-vote country celebrated in the daily post).

## 6. Decisions (B1, B3, B5, B6 approved 2026-11-10 as recommended; B2, B4 recommended, not objected)

- **B1 Theme driver.** (a) the viewed region: world view = world mood, zoomed = that continent's mood;
  (b) your country's mood always; (c) keep world-only. *Recommend (a):* it shows all six Earths in
  normal use, costs one line, and makes zooming feel like travelling. (b) ties the whole screen to a
  guess that is often wrong.
- **B2 First-run globe position.** (a) face the guessed pin on load, pin visible before any tap;
  (b) keep facing Africa/Europe and rely on the badge text. *Recommend (a).*
- **B3 Journal.** (a) include R2 in PR B; (b) defer to Phase 7. *Recommend (a):* client-only, the
  largest retention lever available, and it makes the chip state worth looking at.
- **B4 The quiet Earth.** Which theme shows when the world is quiet: (a) Waterworld (calm) with the
  halo dimmed; (b) a seventh neutral theme. *Recommend (a):* no new theme to design, test and
  translate; the dimmed halo is the signal.
- **B5 Theme label under the headline.** (a) keep the name but give it a sentence: *"Waterworld · the
  oceans rise when the world is calm"* (×6 ×4 languages); (b) drop the label from the header and show
  it only in the language of the quiet/zoom hints; (c) keep as is. *Recommend (b):* the headline area
  gets simpler, and the themes still have names where they are explained.
- **B6 Theme names and tone.** (a) keep all six names; (b) rename "Ruined Earth" → "Ember Earth" and
  "Simulation Earth" → "Static Earth" (same visuals, less glee at misfortune); (c) a "serious" flag the
  aggregator can set to hold the Waterworld theme. *Recommend (b):* a copy change, no mechanism, and the
  visuals already say it.

## 7. Exit criteria for the bridge as a whole
1. Every row in §3 meets its criterion; mutations listed in each PR.
2. `pnpm check`, e2e (11 viewports, 4 languages) and the Pixel bench pass; initial JS still < 150 KB gz
   and within 5 KB of today's 79 KB (the result line and journal are small; the particles sprite is one
   canvas).
3. The Phase 6 design doc can name `PolledSource`, the vote persistence and the re-count path as
   additions to existing seams, with no edit to `main.ts` beyond wiring one constructor.
4. A stranger's first run on a phone (recorded, real device) shows: place first, a pin, the tap, the
   result line with numbers, and no English in a non-English locale.
