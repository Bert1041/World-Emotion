import type { Continent } from "@world-emotion/shared";
import fc from "fast-check";
import type { CountryToContinent, VoteCount } from "./pool";

/** A small stand-in for the Phase 2 generated map, covering every continent. */
export const GEO: CountryToContinent = new Map<string, Continent>([
  ["FR", "EU"],
  ["DE", "EU"],
  ["LU", "EU"],
  ["US", "NA"],
  ["CA", "NA"],
  ["JP", "AS"],
  ["BR", "SA"],
  ["NG", "AF"],
  ["AU", "OC"],
  ["AQ", "AN"],
]);

/** Includes codes outside the map, which must count toward the world only. */
export const countryArb = fc.constantFrom(...GEO.keys(), "XX", "T1", "ZZ");

export const voteCountArb: fc.Arbitrary<VoteCount> = fc.record({
  country: countryArb,
  mood: fc.integer({ min: 0, max: 5 }),
  n: fc.integer({ min: 0, max: 500 }),
});

export const rows = (...r: [string, number, number][]): VoteCount[] =>
  r.map(([country, mood, n]) => ({ country, mood, n }));

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
