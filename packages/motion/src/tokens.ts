import type { SpringConfig } from "./spring";

/**
 * Motion tokens (README §8.3). Every animation reads these, never ad-hoc numbers. Durations are
 * mirrored as CSS variables in apps/web/index.html; a test keeps the two in step.
 */
export const DURATION = {
  /** Taps, toggles. */
  fast: 0.12,
  /** Cards, panels. */
  base: 0.24,
  /** Headline word, bars. */
  slow: 0.6,
  /** Camera drill-down (§8.2.6). */
  glide: 1.2,
  /** World-mood theme cross-fade (§8.5). */
  theme: 2.5,
  /** One check-in ripple ring crossing the globe (§8.2.5). */
  ripple: 2.4,
  /** The check-in face's flight onto your country (§8.2.5), after its pop. */
  flight: 1,
} as const;

/** Spring presets. ω in rad/s; ζ = 1 is critically damped. */
export const SPRING = {
  /** UI that must feel instant but not jump: card height, peek card. */
  snappy: { omega: 22, zeta: 1 },
  /** Camera settle, zoom. */
  gentle: { omega: 9, zeta: 1 },
  /** The check-in pop (§8.2.5): one visible overshoot. */
  bouncy: { omega: 18, zeta: 0.45 },
} as const satisfies Record<string, SpringConfig>;

/** Drag inertia: velocity decays by this factor per second (exponential friction). */
export const FRICTION_PER_SECOND = 0.04;
