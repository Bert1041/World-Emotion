/**
 * Complementary suppression (ADR 0003, decision P3 = A).
 *
 * The privacy floor hides regions with few votes, but a parent minus its published children
 * reveals the hidden remainder exactly. So the remainder itself must be 0 or at least `floor`:
 * when it falls in between, also hide the smallest published child (ties by key).
 *
 * Every published child has n >= floor, so one extra hide always lifts the remainder to
 * >= floor; the loop runs at most once and is written as a loop only for clarity.
 *
 * @returns the keys that are safe to publish.
 */
export function publishable(
  parentN: number,
  children: ReadonlyArray<readonly [key: string, n: number]>,
  floor: number,
): Set<string> {
  const childTotal = children.reduce((s, [, n]) => s + n, 0);
  if (childTotal > parentN)
    throw new RangeError(`children (${childTotal}) exceed parent (${parentN})`);

  const published = children
    .filter(([, n]) => n >= floor)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let remainder = parentN - published.reduce((s, [, n]) => s + n, 0);

  while (remainder > 0 && remainder < floor) {
    const smallest = published.shift();
    if (smallest === undefined) break; // nothing left to hide; the parent itself is below floor
    remainder += smallest[1];
  }
  return new Set(published.map(([key]) => key));
}
