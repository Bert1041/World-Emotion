import type { Continent } from "@world-emotion/shared";
import { COUNTRY_TABLE } from "./countries.generated";

export interface CountryInfo {
  readonly continent: Continent;
  /** False for territories Natural Earth folds into another shape (e.g. RE): drawn as a marker. */
  readonly shape: boolean;
}

/** Every country code we accept: 249 ISO 3166-1 alpha-2 codes plus XK (Kosovo). */
export const COUNTRIES: ReadonlyMap<string, CountryInfo> = new Map(
  Object.entries(COUNTRY_TABLE).map(([code, [continent, shape]]) => [code, { continent, shape }]),
);

/** The shape `@world-emotion/core`'s `buildSnapshot` expects. */
export const COUNTRY_TO_CONTINENT: ReadonlyMap<string, Continent> = new Map(
  [...COUNTRIES].map(([code, info]) => [code, info.continent]),
);

/** For the API's manual country override: rejects XX, T1 and anything not in the map. */
export function isKnownCountry(code: string): boolean {
  return COUNTRIES.has(code);
}
