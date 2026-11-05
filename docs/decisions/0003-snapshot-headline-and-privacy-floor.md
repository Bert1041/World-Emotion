# 0003 — Snapshot headline and privacy floor

- **Status:** accepted (P1, P2a, P3 = A)
- **Date:** 2026-11-05

## Context
- Headline hysteresis needs memory across runs. If each client computed it, clients that started
  watching at different times would disagree.
- Publishing a region's distribution with its raw `n` and its parent's distribution lets anyone
  invert shrinkage and recover exact counts. With n = 1 that is one person's mood.

## Decision
- **P1:** each snapshot region carries `h`, the headline after hysteresis, computed in the aggregator.
- **P2(a):** countries and continents with `n < 5` are omitted from the public snapshot; the client
  falls back to the parent. The world is always published.
- Smoothing and hysteresis read the **private** state (unrounded, every region), never the public
  snapshot, so a region crossing the floor does not jump.

## P3: the floor alone was not sufficient
The floor alone is **not sufficient**. Verified against real `buildSnapshot` output on 2026-11-05:
with FR (70 votes) and DE (25) published and LU (1 sad vote) omitted, `EU − FR − DE` recovers
LU's counts exactly as `[0,0,0,0,1,0]`. Two attack shapes:
1. **Cross-sectional differencing:** parent minus published children. Deterministic, any time.
2. **Temporal differencing:** consecutive snapshots differ by the votes cast in between; at low
   traffic that can be a single vote. Smoothing is invertible, so it doesn't hide this.

**Decision (P3 = A): complementary suppression.** Whenever a parent's hidden remainder (parent
minus published children) would be between 1 and `floor − 1`, the smallest published child is
hidden too (ties by key). Applied to countries within every continent (published or not) and to
continents within the world, whose remainder also holds unknown-country votes. Implemented in
`packages/core/src/suppress.ts`; the original attack is a regression test.

Rejected for now: **(B) noise** (closes temporal differencing too, but needs injected randomness
and makes small regions jitter); **(C) accept and disclose**.

## Residual risks (accepted, must appear on the privacy page, Phase 8)
1. **Temporal differencing** is not addressed: at low traffic, two consecutive snapshots can differ
   by a single vote, revealing that one person somewhere (in a published region) felt a given mood.
   No identity is attached. Revisit with (B) if this matters.
2. **The world is always published**, so with fewer than 5 votes worldwide (launch only) world
   counts are recoverable. No geography is attached.

## Consequences
- Clients must handle an absent country or continent (render the parent, "quiet here").
- `h` for the world with zero votes is happy (uniform-tie rule); the UI must show the quiet state
  from `n`, not from `h`.
