# 0006 — What this is, and who pays past the free tier

- **Status:** accepted
- **Date:** 2026-11-10

## Context
`docs/research/competitor-failure-analysis-2026-11-10.md` found that the survivors in this space are a
nonprofit (How We Feel), a bootstrapped private tracker (Daylio) and a solo developer's globe funded by
prints, then donations, then a late optional subscription (earth.nullschool.net, 2013–). Products that
treated the idea as a venture (Yo, Secret, BeReal) decayed or sold. Two of the small ones died because
running cost exceeded what the makers would pay for "a joke" (Emojli, Yo). README §7 stops at "a paid
plan is the escape hatch" and never says who pays for it.

## Decision
**World Emotion is a thing that exists, not a business.** It runs on free tiers; if it is ever popular,
the maintainer asks for donations ("buy me a coffee" or similar) and nothing else. No ads, no
subscription, no paid tier, no data sales, no accounts. Success is measured by return (D7) and
sharing, not revenue.

Consequences for the budget: when a daily cap is reached, the app **degrades, it does not die**
(README §7: queue the check-in, keep the last snapshot, say "will count shortly"). A sustained overage
is answered first by the Stage 2 counters (README §7), then by a paid Cloudflare plan **only if
donations cover it**. A "turned down" state (static last snapshot served, check-ins paused with an
honest message) is a designed state, not a failure, so the maintainer can step back without the site
breaking (pre-mortem scenarios 7 and 8).

## Alternatives considered
1. Hobby with no donations at all. Rejected: leaves no answer for a viral day beyond "turn it off".
2. Optional paid journal/insights tier (Daylio pattern). Rejected for now: adds accounts or receipts,
   contradicts the no-accounts line, and the journal is the retention feature; paywalling it works
   against the goal. Revisit only if donations fail and traffic persists.
3. Ads. Rejected: trackers break the privacy promise that is the product's main differentiator
   (BetterHelp, Flo), and BeReal's ads arrived only after its decline.

## Consequences
- Easier: no billing, no accounts, no legal entity work; the privacy page can be short and absolute.
- Harder: nothing funds a second maintainer; the runbook and the dead-man check (research §8) matter
  more, not less.
- Watch: Cloudflare usage at 70% of caps (README §7 alerts); donation link added only once there is
  something to be grateful for (post soft launch, not before).
- The launch community (research §10, item 1) remains open and is decided before Phase 9.
