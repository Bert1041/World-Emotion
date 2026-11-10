# Geo decisions

Decided once, here, and encoded as named constants in `packages/geo-data/scripts/build.ts`. Each one
has its own test in `packages/geo-data/src/geo.test.ts`, and the build **fails** if the source data
drifts in a way that would change one. Approved 2026-11-05. Analysis: `docs/design/phase-2-geo-data.md`.

## Sources

| Source | Version | Used for | Licence |
|---|---|---|---|
| Natural Earth admin-0 countries | v5.1.2, 110m + 50m, SHA-256 pinned | Shapes; continent for most countries | Public domain |
| GeoNames `countryInfo.txt` | vendored 2026-11-05, SHA-256 pinned | Country code list; continent where NE has none | CC BY 4.0 (credit GeoNames) |

## The set

**250 codes:** all 249 ISO 3166-1 alpha-2 codes plus `XK` (Kosovo). GeoNames' retired codes `AN`
(Netherlands Antilles) and `CS` (Serbia and Montenegro) are excluded. No names are stored; the
client uses `Intl.DisplayNames` (localised).

## Decisions

| # | Case | Decision |
|---|---|---|
| G1 | NE "Seven seas (open ocean)": GS, HM, IO, MU, MV, SC, SH, TF | GeoNames continent: GS, HM, TF → AN; IO, MV → AS; MU, SC, SH → AF |
| G2 | Cyprus (NE Asia / GeoNames Europe) | **Europe** |
| G2 | Timor-Leste (NE Asia / GeoNames Oceania) | **Asia** (same as NE; kept explicit so a data update cannot move it silently) |
| G3 | 13 ISO codes with no NE shape: BQ, BV, CC, CX, GF, GI, GP, MQ, RE, SJ, TK, UM, YT | Own entries, GeoNames continent (e.g. RE → AF, GF → SA), `shape: false`: pickable from list/search, drawn as markers |
| G4 | NE shapes with no ISO code: Somaliland, N. Cyprus, Siachen Glacier | Kept in the TopoJSON with no `id`: drawn neutral, unselectable, no claim made |
| G5 | Kosovo | `XK` → Europe. Cloudflare's actual code for Kosovo is **unverified**; Phase 5 logs unknown codes |
| — | Codes whose NE shapes span continents (only AU: Indian Ocean Ter. is Asia) | GeoNames' continent, which must be one of NE's (AU → OC). Shapes sharing a code are **merged** |
| — | Transcontinental (RU, TR, GE, AZ, AM, KZ, EG, PA) | NE and GeoNames agree: RU → EU; TR, GE, AZ, AM, KZ → AS; EG → AF; PA → NA |

## Validation boundary

`checkinRequestSchema` (shared) checks the **format** `^[A-Z]{2}$`; `isKnownCountry` (geo-data)
checks **membership**. `shared` cannot import `geo-data` (it would be a cycle), so the API
applies both (done in Phase 5: `apps/api/src/app.ts`, tested in `apps/api/test/checkin.test.ts`).

## Sizes (gzipped)

| File | Geometries | Quantisation | Gzip |
|---|---|---|---|
| `world-110m.topo.json` | 177 | 1e4 (~4 km grid) | 26 KB |
| `world-50m.topo.json` | 240 | 1e4 | 138 KB (1e5: 227 KB) |

The 50m file is heavy for slow mobile data; whether to simplify it or ship only the 62 small
countries missing at 110m is decided by the Phase 3 performance spike, with measurements.
