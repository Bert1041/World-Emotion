/** Easing for time-based tweens (not springs). All map [0, 1] → [0, 1], clamped. */

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)`, so a tween in canvas matches the same curve in CSS. x(s) is
 * monotonic for x1, x2 in [0, 1] (CSS requires it), so bisection always converges: 32 halvings
 * give ~2e-10 in x, far below a pixel or a frame. Called a few times per frame; speed is moot.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  return (t: number) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) return x;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (sx(mid) < x) lo = mid;
      else hi = mid;
    }
    return sy((lo + hi) / 2);
  };
}

/** The app's standard "out" curve, same as CSS `cubic-bezier(.2, .8, .2, 1)` in index.html. */
export const easeOut = cubicBezier(0.2, 0.8, 0.2, 1);
