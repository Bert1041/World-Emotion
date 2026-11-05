# Vendored data

## `geonames-countryInfo.txt`

- **Source:** GeoNames, <https://download.geonames.org/export/dump/countryInfo.txt>
- **Retrieved:** 2026-11-05, SHA-256 `79f8f59ea01cbb40438bf1856dd6c2ff201f03f8fc72d0530b2646aaf603ef04`
- **Licence:** [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: GeoNames (<https://www.geonames.org>).
- **Used for:** the list of country codes, and continents only where Natural Earth has none (see `docs/geo-decisions.md`).
- **Why vendored:** the URL is unversioned and its content can change without notice. The build verifies this checksum.
