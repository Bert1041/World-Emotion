# Phase 3 design: globe performance spike (go/no-go)

Status: **done: GO** (ADR 0005). §6 S1–S3 approved. The gate now measures the shipped "move" map on animation frames instead of 110m (README §8.8, second fallback).

**Question this phase answers:** can a d3-geo orthographic globe on layered Canvas 2D hold the frame
budget while dragging, with idle weather particles, on the reference device (Pixel 6 Pro, ADR 0004)?
Everything else in the app sits on this answer, so it is measured, not eyeballed.

## 1. What the spike contains (and does not)

**In** (`apps/web`, Vite + TypeScript, no Svelte yet; the engine is framework-agnostic by design):
- Orthographic projection (d3-geo), **two stacked canvases**: base (ocean, land, fills, borders;
  redrawn only when dirty) and FX (particles; every frame).
- Drag with simple inertia, tap-to-select (projection invert + `geoContains`), fake snapshot colours.
- Level of detail: **110m while dragging, 50m at rest** (this also settles the 138 KB question from
  Phase 2 with numbers).
- Particles in a pooled struct-of-arrays (`Float32Array`), zero allocation per frame.
- DPR cap, `visibilitychange` pause, dev overlay (frame time, particles, DPR, LOD).

**Out:** Svelte UI, motion package (springs/tokens), check-in, network, PWA, final art. Drag inertia
here is deliberately crude; Phase 4 replaces it.

## 2. How it is measured

A **benchmark mode** in the page runs a deterministic scripted drag (fixed rotation path, so every
run is identical) for 10 s and records, per frame: rAF interval and script time (update + draw).

A **runner** (`tools/bench`, Node) drives the phone over USB with the Chrome DevTools Protocol:
`adb reverse` serves the **production build** (`vite preview`, not dev mode) as `localhost` on the
phone, so nothing is exposed on the network; it opens the page, optionally applies CPU throttling,
runs each scenario, and writes JSON results.

Cross-check: `adb shell dumpsys gfxinfo com.android.chrome framestats` reports frames as the
**display** saw them. rAF intervals alone can look smooth while the compositor drops frames.

**Scenario matrix** (each run 10 s, 3 repeats, median of repeats reported):

| Axis | Values |
|---|---|
| Particles | 0 · 500 · 1500 |
| Map detail while dragging | 110m · 50m |
| DPR | 1.5 · 2 (cap) |
| Display | 120 Hz (native) · 60 Hz |
| CPU throttle (rough low-end proxy, CPU only) | 1× · 4× |

## 3. Pass bar (proposed earlier, accepted unless changed in §6)

During the scripted drag with **500 particles, 110m while dragging, DPR 2**:
- p95 frame interval **≤ 17.5 ms at 60 Hz** (≤ 11.1 ms at 120 Hz)
- median script time **≤ 8 ms** per frame
- dropped frames (display-reported) **< 1 %**

## 4. Outcomes

- **GO:** record numbers in ADR 0005; promote reviewed engine parts; keep the bench permanently.
- **NO-GO:** README §8.8 fallbacks in order (FX to `OffscreenCanvas` worker → lower detail while
  dragging → WebGL renderer), re-run the same bench after each.

## 5. What happens to spike code

Promoted only by review, file by file: projection/layers, particle pool, LOD switch and the bench
harness are written to be kept. Throwaway: drag inertia, fake snapshot, overlay styling. No spike
code survives by accident.

## 6. Decisions needed

**S1. Add the 4× CPU-throttled run to the gate.** Because ADR 0004 drops the low-end phone, I
recommend the gate require a pass **at 4× throttle too** (at 60 Hz). It is a CPU-only proxy (the
GPU stays fast), so it is weaker than a real cheap phone, but it costs nothing and catches script
cost that would sink a cheaper device. *Recommend: yes.*

**S2. Pass bar** as in §3? *Recommend: yes.*

**S3. Runtime dependencies:** `d3-geo` (projection, ~tens of KB) and `topojson-client` (decode).
Both are in the README's stack. `vite` as build tool. *Recommend: yes.*
