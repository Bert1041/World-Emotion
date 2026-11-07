# 0004 — Reference device for performance

- **Status:** accepted
- **Date:** 2026-11-05

## Context
README §8.7–8.8 make a real low-end Android the go/no-go reference for the Canvas 2D globe. The
available device is a **Pixel 6 Pro** (Google Tensor, 12 GB RAM, 120 Hz, Android 17, Chrome 156): a
2021 flagship.

## Decision
The Pixel 6 Pro is the only reference device. No low-end phone will be tested before launch.

## Alternatives considered
1. Pixel now (provisional), a ~$100–150 Android re-test before Phase 6. Recommended, not chosen.
2. Wait for a cheap phone before Phase 3. Not chosen.

## Consequences
- **Risk accepted:** the gate measures a phone several times faster (especially its GPU and memory
  bandwidth) than the README's stated audience. A pass here does not show the globe is smooth on
  low-end phones. Launch could be janky for exactly those users.
- Mitigations kept at no cost: the benchmark stays repeatable, so any phone can be measured later
  with one command; adaptive quality tiers (§8.4) still ship; CPU-throttled runs on the Pixel give
  a rough (CPU-only) proxy.
- Revisit if real-user frame data or feedback shows jank, or if a cheap phone becomes available.
