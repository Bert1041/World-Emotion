import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { poolCounts } from "./pool";
import { GEO, rows, sum, voteCountArb } from "./test-fixtures";

describe("poolCounts", () => {
  it("sums countries into their continent and the world", () => {
    const p = poolCounts(rows(["FR", 0, 3], ["DE", 0, 2], ["DE", 4, 1], ["US", 1, 7]), GEO);
    expect(p.countries.get("DE")).toEqual([2, 0, 0, 0, 1, 0]);
    expect(p.continents.get("EU")).toEqual([5, 0, 0, 0, 1, 0]);
    expect(p.continents.get("NA")).toEqual([0, 7, 0, 0, 0, 0]);
    expect(p.world).toEqual([5, 7, 0, 0, 1, 0]);
  });

  it("pools votes, not averages: a big country outweighs a small one", () => {
    const p = poolCounts(rows(["FR", 0, 99], ["LU", 5, 1]), GEO);
    expect(p.continents.get("EU")).toEqual([99, 0, 0, 0, 0, 1]); // an average of averages would be 50/50
  });

  it.each(["XX", "T1", "ZZ"])("counts unknown country %s toward the world only", (code) => {
    const p = poolCounts(rows([code, 2, 4]), GEO);
    expect(p.world).toEqual([0, 0, 4, 0, 0, 0]);
    expect(p.countries.size).toBe(0);
    expect(p.continents.size).toBe(0);
  });

  it("skips zero-count rows entirely", () => {
    const p = poolCounts(rows(["FR", 0, 0]), GEO);
    expect(p.countries.has("FR")).toBe(false);
  });

  it.each([
    ["mood 6", rows(["FR", 6, 1])],
    ["mood -1", rows(["FR", -1, 1])],
    ["negative n", rows(["FR", 0, -1])],
    ["fractional n", rows(["FR", 0, 1.5])],
  ])("throws on a malformed row (%s)", (_, r) => {
    expect(() => poolCounts(r, GEO)).toThrow(RangeError);
  });

  it("conserves votes: world total = all rows; continents total = known-country rows", () => {
    fc.assert(
      fc.property(fc.array(voteCountArb, { maxLength: 60 }), (r) => {
        const p = poolCounts(r, GEO);
        expect(sum(p.world)).toBe(sum(r.map((x) => x.n)));
        const known = r.filter((x) => GEO.has(x.country));
        expect(sum([...p.continents.values()].map(sum))).toBe(sum(known.map((x) => x.n)));
        expect(sum([...p.countries.values()].map(sum))).toBe(sum(known.map((x) => x.n)));
      }),
    );
  });
});
