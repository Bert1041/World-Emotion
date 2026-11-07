# 0005 — Canvas 2D globe: GO

- **Status:** accepted
- **Date:** 2026-11-07

## Context
README §8.8 and `docs/design/phase-3-globe-spike.md` make the Canvas 2D globe a go/no-go gate on
the reference phone (ADR 0004: Pixel 6 Pro, Chrome 158). Pass bar (design §3), during the scripted
drag with 500 particles at DPR 2:

- p95 frame interval ≤ 17.5 ms at 60 Hz (≤ 11.1 ms at 120 Hz)
- median script time ≤ 8 ms per frame
- dropped frames < 1 %
- S1: the run must also pass at 4× CPU throttle (60 Hz).

How the numbers were taken: `node tools/bench/run.ts --device=android --matrix=gate --repeats=3`.
Each run starts at thermal status ≤ 1, and scenario order is rotated per repeat. The values below
are medians of 3 runs. Raw results are in `docs/bench/`.

## What the spike found

1. **The first full gate failed** (`2026-11-07-android-gate-before-idle-fix.json`). Script time was
   10.5 ms at 1×, and at 4× the run dropped 60 % of frames. Separately, frames counted as "idle"
   reached 531 ms at 4×: theme fades and layout easing redrew the detailed 50m map (about 80k
   points) on every frame.
   Fixed: every animation frame now uses the light map, and 50m is drawn once on settle
   (`2026-11-07-android-gate-after-idle-fix.json`).
2. **Drawing cost tracks the number of points almost linearly.** At 4× on the Mac it went from
   2.4 ms at 1.5k points to 10.4 ms at 10.6k. Particles cost about 0.3 ms (one fill per mood). So
   the first README fallback (move the effects to an OffscreenCanvas worker) would not help, and it
   was skipped.
3. **Second fallback applied: a lower-detail map while moving.** The "move" map is 110m simplified
   once at load to 25 % of its points (Visvalingam, spherical area, on the topology, so shared
   borders stay identical). It is used on animation frames at world zoom. Zoomed into a continent,
   moving frames use 110m: the simplified outline looks crude up close, and culling already skips
   the far side. Settled frames use 50m.

## Result (`2026-11-07-android-gate-move-map.json`)

| Pixel 6 Pro, 60 Hz | p95 interval | median script | dropped | Verdict |
|---|---|---|---|---|
| **Shipped, 1×** | 16.7 ms | **6.1 ms** | 0 % | pass |
| **Shipped, 4×** | 16.7 ms | 11.6 ms | 0.17 % | pass (see below) |
| Previous setup (110m on animation frames), 1× | 16.7 ms | 10.0 ms | 0 % | fails script bar |
| Previous setup, 4× | 49.8 ms | 26.4 ms | 46.5 % | fails |

- **120 Hz:** Chrome on this phone gives web pages 60 fps even when the display runs at 120 Hz, so
  the 120 Hz interval bar cannot be met or measured. Script time in that mode is 4.4 ms, within the
  8.3 ms budget.
- **4× rule, as decided on 2026-11-07:** at 4× only the interval and dropped-frame bars apply. The
  8 ms script bar is a budget for real (1×) speed. Applying it to a run slowed 4× would mean 2 ms at
  1×.
- **The 4× result is not uniform.** Two of the three runs were clean (0 % and 0.17 % dropped). The
  third had a p95 of 33.3 ms and dropped 21.4 %, with a script p50 of 17.6 ms, still at thermal
  status 1. The table shows medians.

**Decision: GO.** Canvas 2D (d3-geo orthographic) stays the renderer. WebGL remains the documented
fallback and is not scheduled.

## Render correctness
`--verify` compares optimised against reference drawing at 180 poses:

- **cull:** pixel-identical on all three maps.
- **precision(0):** pixel-identical on 110m and 50m. On the move map, at most 210 of 360,000 px
  (0.06 %) differ, because long simplified edges are drawn as chords. These frames appear only
  while moving.
- **Self-test:** a wrong view centre gives about 108k px of difference, so the check can fail.

## Spike code: promote or delete (design §5)

| File | Outcome |
|---|---|
| `engine/globe-layer.ts`, `engine/geo.ts` (LOD + move map), `engine/particles.ts`, `engine/stats.ts`, `engine/layout.ts` (+ tests), `engine/color.ts`, `engine/palette.ts`, `engine/themes.ts` | **Promoted.** Reviewed in the Phase 3 PR. |
| `tools/bench/run.ts` | **Promoted.** The bench stays permanent and is re-run when rendering changes. |
| `engine/camera.ts` | **Kept until Phase 4.** Glide and zoom move onto `packages/motion` springs. |
| Drag inertia and idle rotation in `main.ts` | **Throwaway.** Replaced in Phase 4. |
| `demo/snapshot-sim.ts`, the dev theme switcher | **Throwaway.** Removed when real snapshots arrive (Phase 6). |
| `main.ts` wiring | Kept as the app shell; split into modules as Phase 4 adds the check-in. |

## Alternatives considered
1. **NO-GO under a strict reading of S1** (8 ms even at 4×), then WebGL. Rejected: it measures the
   throttle, not the app. It would also replace a working renderer with a multi-day rewrite.
2. **An even lighter move map** (15 %) to make all three 4× runs clean. Deferred: the outline gets
   visibly cruder, and adaptive tiers (README §8.8) are the better tool for slow devices.

## Consequences
- **Not measured on the phone:** frames while moving zoomed into a continent (110m with culling).
  The gate covers world view only. Watch this when Phase 4 adds a zoomed bench pose.
- **Risk carried from ADR 0004:** this is a 2021 flagship. 4× is a CPU-only proxy, and one 4× run
  in three still dropped frames. Adaptive quality (lighter move map or fewer particles when frames
  drop) is the planned answer, not WebGL.
- Any change to drawing re-runs the gate and `--verify` before merge.
