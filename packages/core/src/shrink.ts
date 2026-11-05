import { at, type Counts, type Dist, total } from "./dist";

/**
 * Shrinkage toward the parent (README §5.4):
 *   estimate = (counts + k * parent) / (n + k)
 * n = 0 returns exactly the parent; n ≫ k approaches the local distribution.
 */
export function shrink(counts: Counts, parent: Dist, k: number): number[] {
  if (counts.length !== parent.length) throw new RangeError("counts and parent length differ");
  if (!(k > 0)) throw new RangeError(`k must be positive, got ${k}`);
  const n = total(counts);
  return counts.map((c, i) => (c + k * at(parent, i)) / (n + k));
}
