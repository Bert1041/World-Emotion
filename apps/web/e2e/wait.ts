/**
 * Timeout for waits on an animation *finishing* (glide, fling, spring-back, ripple, flight, card).
 * Those tests check that motion ends, not how fast: the app caps each frame's step at 50 ms so
 * nothing jumps, so with slow frames (CI renders without a GPU, 5120 px canvases at 3440 × 1440
 * DPR 2) a 1.2 s glide takes several seconds of wall time. Tight limits here made layout tests
 * fail on frame speed (CI 2026-11-09). Responsiveness checks keep their own short limits.
 */
export const UNTIL_DONE = { timeout: 20_000 } as const;

/**
 * Wait until the page has painted `n` frames. After `__bench.face()` the new rotation is applied on
 * the next frame; reading a screen point before that taps where the place used to be. A fixed
 * 200 ms wait did this under load (taps landed 10° off; 2026-11-09).
 */
export const frames = (page: import("@playwright/test").Page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise<void>((done) => {
        const step = (left: number) =>
          left === 0 ? done() : requestAnimationFrame(() => step(left - 1));
        step(k);
      }),
    n,
  );
