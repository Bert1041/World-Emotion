import { at, type Dist } from "./dist";

/**
 * Blend weight for the new value after `dtSeconds`, from a half-life (README G3):
 *   alpha = 1 - 2^(-dt / halfLife)
 * Defined by elapsed time, so changing the aggregation cadence does not change the feel.
 * Callers must handle dt <= 0 themselves (a duplicate or clock-skewed run).
 */
export function smoothingAlpha(dtSeconds: number, halfLifeSeconds: number): number {
  if (!(dtSeconds > 0)) throw new RangeError(`dt must be positive, got ${dtSeconds}`);
  if (!(halfLifeSeconds > 0))
    throw new RangeError(`half-life must be positive, got ${halfLifeSeconds}`);
  return 1 - 2 ** (-dtSeconds / halfLifeSeconds);
}

/** alpha * current + (1 - alpha) * previous. A convex blend of two distributions is one too. */
export function blend(current: Dist, previous: Dist, alpha: number): number[] {
  if (current.length !== previous.length) throw new RangeError("dist length differs");
  return current.map((c, i) => alpha * c + (1 - alpha) * at(previous, i));
}
