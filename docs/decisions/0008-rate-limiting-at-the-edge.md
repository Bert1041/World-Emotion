# 0008 — Rate limiting at the edge, plus Turnstile

- **Status:** accepted
- **Date:** 2026-11-22

## Context
Phase 5 rate-limited check-ins with the Workers Rate Limiting binding (10 a minute per IP, 3 a minute
per device) and listed one open risk: confirm the binding works on the free plan.

On 2026-11-22 the API was deployed to the real account (workers.dev, no domain yet) and tested:
5 check-ins from one device in a burst, 6 at one a second, 6 at one every two seconds, and 40 from
one IP over a minute against a limit of 10. **Every request was accepted (65 of 65).** The code
reads the binding's answer and returns 429 when told to (proved locally); the binding never said no.
Cloudflare's documentation calls the binding approximate, per location and eventually consistent
("requests can exceed your configured limit before those updates arrive"), says nothing about the
free plan, and points to Durable Objects for strict limits.

Without a working limit, one script could create thousands of fake check-ins with new device keys:
skewing the published mood and spending the 100k daily D1 writes.

## Decision
- **A Cloudflare WAF rate-limiting rule on `POST /checkin`, per IP**, enforced at the edge before the
  Worker runs. The free plan includes one such rule. It needs the domain (the rule belongs to a
  zone), so it is set up with the domain.
- **Turnstile on a device's first check-in** (already planned for Phase 8, launch gate): it stops
  scripts from minting new device keys, which an IP limit alone cannot.
- **The binding stays** in the code: it costs nothing, and the code is right if Cloudflare's
  behaviour changes.
- **Launch gate:** no public launch (Phase 9) until both are live and a sustained test from one IP
  is seen to be refused.

Until the domain exists the API accepts only `localhost` origins, so no other site can send check-ins
through a browser; a script still could, which is why this is a gate, not a nice-to-have.

## Alternatives considered
- **A Durable Object counter:** strict and available now, about a day of work and a little latency per
  check-in; most of it would be redundant once the edge rule exists.
- **A D1 counter table** (Phase 5's fallback): halves the write budget (about 33k to 16k new devices a
  day) to count requests.
- **Keep the binding alone:** measured to do nothing on this account.

## Consequences
- README §7's write budget stays as measured (2 rows per new check-in, 0 per replay, 1 per purge).
- The domain becomes a security prerequisite, not only a cost one.
- To watch: the WAF rule's per-IP limit punishes shared IPs (offices, carrier NAT); start generous
  (e.g. 20 a minute) and let Turnstile carry the bot defence.
