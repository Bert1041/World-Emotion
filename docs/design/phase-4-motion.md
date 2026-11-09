# Phase 4 design: `packages/motion` + the check-in moment

Status: **approved** (2026-11-07: M1(a) Svelte 5, M2 language-region guess, M3 yes, M4 yes; "follow your recommendation").

**Question this phase answers:** does the app *feel* alive and identical on 60 Hz and 120 Hz
screens? And does checking in feel like the "dopamine hit" README §8.2.5 asks for, on the Pixel,
without breaking the frame budget from ADR 0005?

## 1. `packages/motion` (pure, no DOM)

Same rule as `core`: the package is pure, and Biome bans DOM, timers and `Date`. Time is passed in.

| Module | What it does | Replaces |
|---|---|---|
| `step.ts` | Fixed-step integrator: an accumulator with a 1/240 s step and a cap on catch-up steps after a stall (no "spiral of death") | ad-hoc `dt` in `main.ts` |
| `spring.ts` | Damped spring (value + velocity). Presets: `snappy`, `gentle`, `bouncy` | camera ease, inertia |
| `ease.ts` | Easing curves for tweens that are not springs | inline cubic-bezier maths |
| `tokens.ts` | Durations `fast 120`, `base 240`, `slow 600`, `glide 1200` ms plus spring presets (README §8.3), mirrored to CSS variables | magic numbers |
| `oklab.ts` | Colour interpolation | `apps/web/src/engine/color.ts` (moved) |
| `sphere.ts` | Great-circle interpolation of view centres (slerp) | slerp inside `camera.ts` |
| `sun.ts` | Sub-solar point from a time (a few lines of solar-position maths) | new (day/night, M3) |

**Tests.** Each module gets unit tests and a mutation check. The headline test steps the same spring
at 60 Hz and 120 Hz frame rates and expects the same trajectory within 1e-9 (PLAN exit criterion).
`sun.ts` is checked against published equinox and solstice sub-solar points.

## 2. Wiring the motion into the app

- **Camera:** glide and zoom move onto springs and tokens. Drag inertia uses friction plus a spring
  settle, with a rubber band at the zoom limits (README §8.2.2). This replaces the spike's crude
  inertia (ADR 0005: throwaway).
- **Zoom gestures (as built, 2026-11-07):** pinch and wheel (ctrl+wheel for a trackpad pinch) are a
  rubber band between the two fitted levels, not free zoom. Free zoom in world view would put the
  globe under the headline and break "no text on the Earth". Pulled in past ×1.25 over a continent,
  the camera drills in; pulled out past ×0.8 while zoomed, it returns to the world; anything less
  springs back.
- **Fling:** the release velocity is the mean over the last 100 ms of moves (a pause before
  letting go leaves none, so no fling), with at least one frame of span and a 720°/s cap.
- **World mood change:** colours tween in OKLab over the token duration. The headline word
  cross-fades and the breakdown bars flow to their new shape (§8.2.4).
- **Phone peek card** (decided 2026-11-07): collapsed to region plus mood by default; swipe up for
  the breakdown. The map is re-fitted to the card's current height and springs with it.

## 3. The check-in moment (polish first)

1. **Mood picker:** six faces, each named in text (never colour alone), reachable from the keyboard.
2. **Tap a mood:** the face pops with a spring, then drops onto your country on the globe. The
   camera turns your country to face you first if it is on the far side.
3. **A ripple** expands from your country across the globe. It is a small circle on the sphere
   (`geoCircle`), drawn on the FX layer. It costs one path of about 100 points per frame while it
   runs, and the bench measures it.
4. **The counts tick up**, and the country, its continent and the world update.
5. **Haptics:** one 30 ms `navigator.vibrate` tick on Android as the face lands (M4); none on zoom. 12 ms was tried first and could not be felt on the Pixel 6 Pro (review 2026-11-08). iOS has no vibration API.

**There is no server yet** (Phase 5). The check-in goes into the demo snapshot simulator and runs
through the real `buildSnapshot`, so the numbers you see move for real reasons. Country for now:
see M2.

**Country picker (decided 2026-11-08, replaces a native dropdown the user found off-theme):** the
bar shows a pin chip ("📍 Nigeria · move"). "move" turns the globe into the picker: tap where you are
and a pin drops on that exact spot; ocean taps do nothing; dragging still rotates. A search in the
same bar covers keyboards and countries too small to tap. Measured on the 50m map: Vatican and
Tuvalu are zero-area slivers (quantisation), so search is the only way to reach them; README §8.6's
magnified tap radius (Phase 7) is the planned fix for small countries on the globe itself. A guessed
or searched country's pin goes inside the country on its largest landmass (`engine/pin.ts`; 39 of
237 whole-shape centroids fall outside their country, France's in the Atlantic).

**Reduced motion:** no pop, drop or ripple. The mood is acknowledged with a cross-fade, and the
counts update without ticking.

## 4. Exit criteria

- **A CI check for the initial-JS budget** (< 150 KB gzipped, README §8.7). README says it is
  enforced, but no such check exists yet. It is added at the start of this phase, before the
  framework lands, so M1's cost is measured, not guessed.
- Every `packages/motion` module is unit-tested and mutation-checked. The 60 Hz vs 120 Hz spring
  test passes, and fails when the fixed step is replaced by raw `dt` (that is its mutation).
- The check-in moment is reviewed **by you on the Pixel**, not only on desktop.
- The `prefers-reduced-motion` path is verified in real Chrome (Playwright `emulateMedia`): no
  particles, no rotation, no ripple.
- The Pixel gate is re-run with a check-in ripple in the scripted drag. It must not regress from
  ADR 0005: 1× script time ≤ 8 ms, < 1 % dropped frames.
- The existing layout tests stay green (no text on the Earth), now including the picker and the peek
  card. A new browser test covers the check-in flow end to end.

## 5. Not in scope

The API and the database (Phase 5), real snapshots (Phase 6), sound, the share card, adaptive
quality tiers (README §8.4, planned for after the motion lands), and a zoomed bench pose (noted in
ADR 0005; added here only if cheap).

## 6. Decisions needed

**M1. UI framework.** README §8.1 says the DOM layer is **Svelte**. The prototype is plain
TypeScript, and this phase adds most of the UI (picker, peek card, counters, live regions).
- (a) Adopt **Svelte 5** now: the README's stack, compiled, a few KB of runtime. The existing panel
  and header are ported once.
- (b) Stay plain TypeScript and revisit at Phase 7.

*Recommend (a):* the UI roughly triples in this phase, and porting later costs more than porting
two small components now. Today's initial JS is 49 KB gzipped (map data is lazy-loaded: 27 KB for
110m, 133 KB for 50m), so the < 150 KB budget has room.

*Measured after adopting it (2026-11-07):* initial JS **49.4 → 64.6 KB gzipped** (+15 KB, more
than the "few KB" estimated above; 43% of the budget). Type-checking `.svelte` files with TypeScript
7 needs `svelte-check --tsgo`, which requires TypeScript 6 installed beside 7: `apps/web` has
`typescript@6.0.3` (used only by svelte-check) and TS 7 as `@typescript/native`, which its own
`tsc` typecheck calls explicitly. The rest of the repo is unchanged on TS 7.

**M2. Which country a demo check-in lands on** (before Phase 5 derives it from the request).
*Recommend:* guess it from the browser's language region (`navigator.language`, e.g. `en-NG` →
Nigeria), with a "change" link to a country list. No location permission is asked for. Phase 5
replaces the guess with the server's answer.

**M3. Day/night band (§8.2.7) in this phase?** The solar maths is in `packages/motion` anyway, and
drawing it costs one filled circle. The base layer redraws it about once a minute, not every frame.
*Recommend: yes.*

*As built (2026-11-09):* `engine/night.ts`. Darkening deepens continuously through twilight, from
sunset (sun 0° below the horizon) to the end of astronomical twilight (18° below), reaching 31% in
full night; the day side is untouched. Drawn per pixel: a 96² texture of the shade (each texel's
angle to the sun is a dot product; alpha from a lookup table) is scaled up and clipped to the globe,
over land and borders, under the selected outline and the rim. The sun is recomputed once a minute;
bench runs use a fixed time.

Two earlier versions were measured and replaced (desktop M2, `tools/bench --matrix=phase4`,
script ms p50/p95 at 4× CPU, docs/bench/2026-11-09-desktop-phase4-*.json): 4 stacked circles
showed as stripes; 13 circles were smooth but cost 7.7/9.5 against 4.8/6.5 without night (clipping
and projecting ~2,200 circle points a frame). Per-pixel with the lookup table: 5.2/6.9, with a
ripple running 5.7/7.4; 0 missed frames. Not yet measured on the Pixel.

Tests: unit (darkness through twilight, no step anywhere, texture vs. the spherical oracle in five
views including the sun behind the globe) and Chrome with a fixed page clock (night ocean ~31%
darker than day ocean in one frame; control with `?opt=…,nonight`). Mutations caught: latitude not
flipped, shade on the sun's side, screen-y not flipped, twilight 10° early, camera rotation
ignored, band not drawn, sun six hours off, wrong lookup index.

**Found while testing the band: countries flashing inside out while spinning (fixed 2026-11-09).**
Single frames filled the whole globe with one country's colour. Two causes: (1) simplification
collapses small islands and slivers into rings of 1–2 distinct points (60+ on the moving map), and
d3's horizon clipping read the two-point ones as inside out (Cyprus, Qatar, Palestine, ...); they are
no longer drawn (`drawable` in engine/geo.ts; the data lists stay complete for pins and search).
(2) Healthy polygons too: about 1 in 10,000 horizon crossings, on every map, whatever the clip angle
or resampling. `engine/clip-guard.ts` checks each polygon that crosses the horizon against the
largest area it could ever cover (orthographic projection is a contraction, so a polygon within ρ
of a centre stays inside a disk of radius 2r·sin(ρ/2)) and drops it for that frame if it breaks it.
Tests: every ring on all three maps; a seeded whole-sphere sweep where raw d3 floods and the guard
never does; the bound is never too tight on real polygons; a Chrome test of the drag that showed it,
which fails with the fixes removed. Cost within noise in the bench; pixel verification unchanged.

**M4. Haptics on by default (Android)?** One short tick per check-in, off under reduced motion.
*Recommend: yes.*
