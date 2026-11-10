# 0007 — Keep hourly country totals; "compared to usual" before any forecast

- **Status:** accepted
- **Date:** 2026-11-10

## Context
The audit found the world headline will rarely change once there are many votes, and the
competitor research found that "how the world feels now" alone gives no reason to return (seven
lookalikes show only that). The user asked whether weather-style forecasting could apply. Weather
forecasting simulates physics and does not transfer; what does transfer is that moods very likely
repeat with the clock and the calendar. A baseline of "what is usual for this place at this hour"
supports two features: a forecast, and the comparison "more stressed than a usual Tuesday morning".

Neither can exist without history, and README §6 said "No history at launch (also a privacy
feature)". History that was not kept cannot be recovered later.

## Decision
1. **From Phase 6, the aggregator archives hourly totals**: one small object per hour holding what
   the public snapshot already contained at that hour, and nothing else:
   - per region (world, continents, countries): raw `n` and the published distribution;
   - **only regions that were published** (at or above the privacy floor, after complementary
     suppression, ADR 0003); a region hidden at that hour is absent from the archive too;
   - no votes, no device hashes, no IP-derived keys, no per-check-in timestamps.
2. **README §6 changes** from "no history" to "no personal history; hourly public totals are kept".
   The privacy page (Phase 8) says so in plain words.
3. **"Compared to usual" is the first feature built on it**, once there are about four weeks of
   real data: a region's current share of a mood against its own average for the same hour of
   the week. A plain fact, checkable against the archive.
4. **Forecasting is a later, optional extra**, only if "compared to usual" proves popular. A
   prediction can be caught being wrong and needs months of data.
5. **Nothing is displayed before real data exists.** A "usual" pattern drawn from demo data would
   be invented (README §5.4: we do not fabricate data).

## Alternatives considered
1. Keep no history (the README as written). Rejected: closes off the strongest return reason the
   research found, permanently for every hour not recorded.
2. Archive every 5-minute snapshot. Rejected for now: 12 times the objects for no feature that
   needs it, and finer steps make snapshot-to-snapshot differencing (ADR 0003 residual risk 1)
   easier to run over history. Hourly is coarser than the live feed, so it adds no new exposure.
3. Archive raw counts including regions below the floor, for better baselines. Rejected: it would
   store exactly what the floor exists to hide.
4. Build the forecast first. Rejected: weaker sentence, more data needed, easier to be wrong.

## Consequences
- Cost: 24 small R2 writes a day (about 730 a month against 1M Class A operations free). No D1
  reads or writes beyond the aggregation that already runs.
- The archive is public-grade data but is **not published as a dataset** until the floor has
  been proven in the wild (research §9: an open dataset is a differencing gift).
- Baselines for small countries will be thin or absent (they are often below the floor). The
  feature must fall back to the continent, as the card does, or say nothing.
- Watch: archive size; the share of hours in which a region is absent (decides which regions can
  ever get a "usual"); any request to add finer grain, which reopens alternative 2.
- Phase 6 design must state the object layout, the retention period (proposal: keep indefinitely,
  revisit at one year) and a test that a region below the floor never reaches the archive.
