/**
 * Timeout for waits on an animation *finishing* (glide, fling, spring-back, ripple, flight, card).
 * Those tests check that motion ends, not how fast: the app caps each frame's step at 50 ms so
 * nothing jumps, so with slow frames (CI renders without a GPU, 5120 px canvases at 3440 × 1440
 * DPR 2) a 1.2 s glide takes several seconds of wall time. Tight limits here made layout tests
 * fail on frame speed (CI 2026-11-09). Responsiveness checks keep their own short limits.
 */
export const UNTIL_DONE = { timeout: 20_000 } as const;
