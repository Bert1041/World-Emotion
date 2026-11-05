# 0001 — Launch product decisions

- **Status:** accepted
- **Date:** 2026-11-05

## Context
README §14 listed open questions that block `packages/core`. `docs/PLAN.md` §1 listed spec gaps G1–G10.

## Decision
1. **Moods:** six — happy, calm, excited, stressed, sad, angry (matches the existing weather and palette design). Stored as integers 0–5 in that order; reordering is a migration.
2. **Window:** fixed 6 hours, defined once as a constant.
3. **World mood:** a pure pool of check-ins, not population-weighted. The app says so in plain language.
4. **Spec gaps G1–G10:** accepted as recommended in `docs/PLAN.md` and written into README revision 3.
5. **Budget stance:** build to the free tier now. A paid Cloudflare plan is the planned escape hatch once the app is monetised; because `core` and `motion` import nothing from Cloudflare, upgrading or moving vendors changes adapters, not product logic.

## Alternatives considered
- **8 moods:** more nuance, but more particle systems, colours and faces to design, and it splits small samples further.
- **Timezone-adaptive window:** fairer across night-time regions, but harder to explain and test. Revisit with real data.
- **Population weighting:** corrects for heavily online countries, but makes small countries with few votes swing the world. A pure pool is honest and simple for a parody app.

## Consequences
- Adding a mood later requires a migration plus new art; deliberate, not casual.
- The world headline will over-represent heavily online countries; this is accepted and disclosed.
