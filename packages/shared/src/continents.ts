/** Continent codes. The country → continent mapping is generated in Phase 2 (packages/geo-data). */
export const CONTINENTS = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"] as const;

export type Continent = (typeof CONTINENTS)[number];
