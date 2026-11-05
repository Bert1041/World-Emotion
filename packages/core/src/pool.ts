import { type Continent, isMoodId } from "@world-emotion/shared";
import { add, type Counts, zeros } from "./dist";

/** One row of `SELECT country, mood, COUNT(*) AS n ... GROUP BY country, mood`. */
export interface VoteCount {
  readonly country: string;
  readonly mood: number;
  readonly n: number;
}

export type CountryToContinent = ReadonlyMap<string, Continent>;

export interface Pooled {
  readonly world: Counts;
  readonly continents: ReadonlyMap<Continent, Counts>;
  readonly countries: ReadonlyMap<string, Counts>;
}

/**
 * Pools raw counts upward. Continents and the world are sums of votes (README §5.3: "pooled,
 * not an average of averages"). A country missing from the map (`XX`, `T1`, anything unknown)
 * counts toward the world only (README G9).
 *
 * Rows come from our own database, so a malformed row is a bug, not user input: throw.
 */
export function poolCounts(rows: readonly VoteCount[], geo: CountryToContinent): Pooled {
  let world = zeros();
  const continents = new Map<Continent, number[]>();
  const countries = new Map<string, number[]>();

  for (const row of rows) {
    if (!isMoodId(row.mood)) throw new RangeError(`invalid mood ${row.mood}`);
    if (!Number.isInteger(row.n) || row.n < 0) throw new RangeError(`invalid count ${row.n}`);
    if (row.n === 0) continue;

    const one = zeros();
    one[row.mood] = row.n;
    world = add(world, one);

    const continent = geo.get(row.country);
    if (continent === undefined) continue;
    continents.set(continent, add(continents.get(continent) ?? zeros(), one));
    countries.set(row.country, add(countries.get(row.country) ?? zeros(), one));
  }
  return { world, continents, countries };
}
