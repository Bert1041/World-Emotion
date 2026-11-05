# 0002 — Tooling baseline

- **Status:** accepted
- **Date:** 2026-11-05

## Context
Phase 0 needs a workspace whose single gate (`pnpm check`) actually fails when code is broken.

## Decision
- **pnpm 11 workspaces**, Node ≥ 26 (`.nvmrc` = 26). Raised from 24 on 2026-11-05: nothing needs 24, and testing only the version we run avoids an untested support claim.
- **TypeScript 7.0.2** (native compiler), strict plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Internal packages export `.ts` source directly; Vite and Wrangler bundle them, so there is no build step per package.
- **Vitest 4.1.12**, root config with `projects: ["packages/*"]`, `passWithNoTests: false`.
- **Biome 2.6.2** for lint and format (one dependency instead of ESLint + Prettier). Markdown is **excluded**: Biome's Markdown formatter rewrote README tables and emphasis during setup, and prose docs should change only by intent.
- **`pnpm check` = lint → typecheck → test.** Vitest strips types without checking them, so typecheck is a separate, mandatory step.
- **Supply chain:** exact version pins, plus `minimumReleaseAge: 20160` (14 days) in `pnpm-workspace.yaml`, which also covers transitive dependencies.

## Alternatives considered
- Vitest 5.1 / Biome 2.6.5: newest, but released under 14 days before setup.
- ESLint + Prettier: more mature rule ecosystem, two tools and more config.

## Consequences
- `biome migrate` rewrote `"recommended": true` to `"preset": "none"` (all rules off). Re-check the linter config after any Biome upgrade or migrate. A lint mutation (unused variable + `==`) must fail.
- **CI** (`.github/workflows/ci.yml`) runs the same `pnpm check` on every push. Actions are pinned to commit SHAs and follow the same 14-day minimum age as npm packages.
- TS 7 is new; if a tool in later phases needs the JS-based compiler API, record it here.
