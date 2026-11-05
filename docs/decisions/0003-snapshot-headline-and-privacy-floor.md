# 0003 — Snapshot headline and privacy floor

- **Status:** accepted (P1, P2a); **P3 open**
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

## Known gap (P3, open)
The floor alone is **not sufficient**. Verified against real `buildSnapshot` output on 2026-11-05:
with FR (70 votes) and DE (25) published and LU (1 sad vote) omitted, `EU − FR − DE` recovers
LU's counts exactly as `[0,0,0,0,1,0]`. Two attack shapes:
1. **Cross-sectional differencing:** parent minus published children. Deterministic, any time.
2. **Temporal differencing:** consecutive snapshots differ by the votes cast in between; at low
   traffic that can be a single vote. Smoothing is invertible, so it doesn't hide this.

Options are in the Phase 1 report. Until P3 is decided, the floor is a partial control.

## Consequences
- Clients must handle an absent country or continent (render the parent, "quiet here").
- `h` for the world with zero votes is happy (uniform-tie rule); the UI must show the quiet state
  from `n`, not from `h`.
