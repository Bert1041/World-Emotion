import { MOOD_COUNT, type MoodId } from "@world-emotion/shared";

/** Raw vote counts per mood, indexed by MoodId. */
export type Counts = readonly number[];
/** A probability distribution over moods, indexed by MoodId; sums to 1. */
export type Dist = readonly number[];

/** Two floats closer than this are treated as equal (ties, margins). */
export const EPSILON = 1e-12;

export const zeros = (): number[] => new Array<number>(MOOD_COUNT).fill(0);
export const uniform = (): number[] => new Array<number>(MOOD_COUNT).fill(1 / MOOD_COUNT);

export function total(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** Element-wise add `b` into a copy of `a`. */
export function add(a: Counts, b: Counts): number[] {
  return a.map((x, i) => x + at(b, i));
}

/**
 * The leading mood. On an exact tie (within EPSILON), `prefer` wins if it is among the tied;
 * otherwise the lowest id wins. Deterministic for identical input.
 */
export function leader(dist: Dist, prefer?: MoodId): MoodId {
  let best = 0;
  for (let i = 1; i < dist.length; i++) if (at(dist, i) > at(dist, best) + EPSILON) best = i;
  if (prefer !== undefined && Math.abs(at(dist, prefer) - at(dist, best)) <= EPSILON) return prefer;
  return best as MoodId;
}

/** Index access that fails loudly instead of yielding `undefined` (noUncheckedIndexedAccess). */
export function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new RangeError(`index ${i} out of range for length ${xs.length}`);
  return v;
}
