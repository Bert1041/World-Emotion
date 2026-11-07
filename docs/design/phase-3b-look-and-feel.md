# Phase 3b: look & feel prototype (mood-driven Earth)

Status: **prototype approved** (2026-11-07: "yh i like"), then refined: text moves out of the way when zoomed, and the layout rule "no text on the Earth" is enforced by browser tests. README §8.5 updated. Inserted before the Phase 3 verdict at the user's request; the
Pixel speed test will then measure this real look instead of the placeholder.

## Direction (user decision, 2026-11-07)

The README §8.5 "warm paper globe" is replaced: **the whole Earth's theme follows the world's
mood.** The theme is driven by the snapshot's world headline `h`, which already has hysteresis
(ADR 0003), so it cannot flicker between close moods. Regions keep their own mood weather on top.

| World mood | Earth theme | Regional mood weather |
|---|---|---|
| happy | Overgrown / lush | rising fireflies |
| calm | Waterworld | slow drifting mist |
| excited | City lights (ecumenopolis) | sparkle bursts |
| stressed | Simulation glitch | jittery static |
| sad | Ice age | falling rain/snow |
| angry | Ruined | rising embers |

The mapping is data (`apps/web/src/engine/themes.ts`) and can be retuned after review.

## Scope of the prototype

- **Theme engine:** six themes as data (sky, ocean, land, borders, atmosphere glow, overlay). A
  world-mood change **cross-fades in OKLab over ~2.5 s**; nothing snaps.
- **Mood weather:** each particle behaves by its region's mood (the six behaviours above), still
  batched one fill per mood, zero allocation per frame.
- **Country fill:** theme land colour tinted toward the region's mood colour by how strongly it
  leads (weak signals look like plain land). Mood hues stay constant across themes, so "green"
  never changes meaning; moods are also named in the UI, never colour alone.
- **Drill-down:** tap a country → the camera **glides along a great circle and zooms** to its
  continent; other continents dim; a panel shows the continent's mood breakdown. Tap a country
  inside → country panel. Back button / tap the ocean → glide back out.
- **Idle life:** slow auto-rotation when untouched, breathing atmosphere glow.
- **Demo mode:** a fake snapshot whose world mood changes every ~20 s, plus a dev switcher to
  preview each theme. Benchmark mode is unchanged (fixed theme, no demo cycling).
- **`prefers-reduced-motion`:** no particles, no auto-rotation, cross-fades only.

## Not in scope

Real data, check-in, sound, final typography, share card. Motion here uses small inline helpers;
Phase 4 moves them into `packages/motion` with tests.

## Consequences to check

- **Contrast:** UI text must stay readable on all six skies (checked per theme before sign-off).
- **Speed:** glow and overlays cost raster time. The Pixel run measures the chosen look.
- README §8.5 is updated once the prototype is approved.
