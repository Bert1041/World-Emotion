# Phase 2 design: `packages/geo-data`

Status: **implemented**; all §4 recommendations approved 2026-11-05. Final record: [docs/geo-decisions.md](../geo-decisions.md).

Changes from this draft: codes and fallback continents come from **GeoNames directly** (vendored, CC BY 4.0) instead of the datasets/country-codes aggregate, whose other columns carry restricted or unclear licences. Level-of-detail split deferred to Phase 3 with measured sizes.

## 1. What the data actually looks like

Facts measured on **Natural Earth v5.1.2** (latest release, 2022-05-13), admin-0 countries, against
the **249 ISO 3166-1 alpha-2 codes** (datasets/country-codes). Scripts in the PR description.

| Finding | Detail | Consequence if ignored |
|---|---|---|
| Feature counts | 110m: 177 · 50m: 242 · 10m: 258 | 62 small countries (SG, VA, MT, MV…) do not exist at 110m |
| **Duplicate codes** | 50m: `AU` ×3 (Australia, Indian Ocean Ter., Ashmore & Cartier). 10m: FR, KZ, BR, AU | A naive code→feature map silently overwrites Australia (this happened in analysis) |
| **No ISO code** (`-99`) | Somaliland, N. Cyprus, Siachen Glacier | Unselectable shapes; nothing to key them by |
| **"Seven seas (open ocean)"** | 8 codes: GS, HM, IO, MU, MV, SC, SH, TF | Not one of our 7 continents |
| **ISO codes with no shape** | 13: BQ, BV, CC, CX, GF, GI, GP, MQ, RE, SJ, TK, UM, YT (≈2.3 M people, mostly French overseas departments drawn as part of France) | Cloudflare reports them by their own code → votes would count to the world only |
| Extra code | `XK` Kosovo (not ISO-assigned) | Must be in the map explicitly |
| Continent agreement | NE vs GeoNames continent: 225 of 237 agree; differences are the 8 seven-seas, AU (merge artefact), **CY**, **TL**, XK | Two genuine editorial calls |

Transcontinental countries need no decision: both sources agree (RU → EU; TR, GE, AZ, AM, KZ → AS; EG → AF; PA → NA).

Cloudflare: `XX` (no data) and `T1` (Tor) are documented; **the code Cloudflare uses for Kosovo is unverified**. Phase 5 logs unknown codes seen in production-like traffic.

## 2. Outputs (generated, committed, reproducible)

- `countries.ts`: `ReadonlyMap<code, { continent, shape: boolean }>` for **all 249 ISO codes + XK**. No names: the client uses `Intl.DisplayNames` (verified locally: `RE → Réunion`, `XK → Kosovo`, French `DE → Allemagne`), which is localised for free.
- `world-110m.topo.json` (drag) and `world-50m.topo.json` (rest / zoom): TopoJSON with one geometry per code (duplicates **merged**), `-99` shapes kept with `id: null`. Sizes measured gzipped and recorded; LOD split decided by measurement.
- `isKnownCountry(code)`, used by the API in Phase 5 for manual overrides.

Build script: downloads the pinned NE release, **verifies SHA-256** (recorded in analysis), converts with `topojson-server` (quantised). Outputs are committed so app builds need no network. A CI job later can regenerate and diff.

## 3. Test plan (the set, not a sample)

- Every one of the 250 codes maps to exactly one valid continent.
- Every coded geometry in both TopoJSON files is in the map; every map entry with `shape: true` has **exactly one** geometry at 50m.
- No code appears twice in a TopoJSON file (the merge happened).
- The check-in schema accepts every map code; `isKnownCountry` rejects `XX`, `T1`, `ZZ`.
- Integration: `buildSnapshot` runs over the **full** map (every country voting) and its output parses.
- Every decision in §4 has its own test, so changing one is a visible diff.

## 4. Decisions needed

**G1. Continent source.** *Recommend:* Natural Earth's continent (it matches the shapes we draw), overriding **only** where NE has none (the 8 seven-seas codes) using GeoNames: GS, HM, TF → AN; IO, MV → AS; MU, SC, SH → AF.

**G2. Two editorial calls.**
- **Cyprus:** NE says Asia, GeoNames says Europe. *Recommend Europe* (EU member; how most Cypriots would see themselves).
- **Timor-Leste:** NE says Asia, GeoNames says Oceania. *Recommend Asia* (also the UN M49 grouping).

**G3. The 13 shapeless territories** (Réunion, Guadeloupe, French Guiana…).
- **(a) Recommend:** their own entries with their real continent (RE → AF, GF → SA…), pickable from the list/search, drawn as small markers. Réunion's mood then counts toward Africa, where it is.
- (b) Alias to the sovereign (RE → FR): simpler, but Réunion's votes would push *Europe's* mood.

**G4. Shapes with no ISO code** (Somaliland, N. Cyprus, Siachen). *Recommend:* draw them in neutral land colour, not selectable, no claim made. Votes from those places land wherever Cloudflare places them.

**G5. Kosovo.** *Recommend:* include `XK` → Europe, and verify Cloudflare's actual code in Phase 5.
