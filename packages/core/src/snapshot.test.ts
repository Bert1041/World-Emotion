import {
  type AggregatorState,
  DEFAULT_CONFIG,
  parseAggregatorState,
  parseSnapshot,
} from "@world-emotion/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { uniform } from "./dist";
import { shrink } from "./shrink";
import { buildSnapshot } from "./snapshot";
import { GEO, rows, voteCountArb } from "./test-fixtures";

const T0 = 1_700_000_000;
const build = (r: ReturnType<typeof rows>, now = T0, previousState?: AggregatorState) =>
  buildSnapshot({ counts: r, countryToContinent: GEO, now, previousState });

describe("buildSnapshot: cold start and shape", () => {
  it("publishes a quiet world and nothing else when there are no votes", () => {
    const { snapshot } = build([]);
    expect(snapshot.world.n).toBe(0);
    expect(snapshot.world.dist).toEqual(uniform().map((p) => Math.round(p * 1e4) / 1e4));
    expect(snapshot.continents).toEqual({});
    expect(snapshot.countries).toEqual({});
  });

  it("uses the shrunk distribution unsmoothed on the first run", () => {
    const { state } = build(rows(["FR", 3, 2]));
    expect(state.world.dist).toEqual(
      shrink([0, 0, 0, 2, 0, 0], uniform(), DEFAULT_CONFIG.shrinkK.world),
    );
  });

  it("stamps version, time and window", () => {
    const { snapshot } = build([]);
    expect(snapshot).toMatchObject({ v: 1, generatedAt: T0, windowSeconds: 21_600 });
  });
});

describe("buildSnapshot: privacy floor (decision P2a)", () => {
  it("omits a country with fewer than 5 votes but keeps it in private state", () => {
    const { snapshot, state } = build(rows(["LU", 4, 4], ["FR", 0, 50]));
    expect(snapshot.countries.LU).toBeUndefined();
    expect(state.countries.LU?.n).toBe(4);
  });

  it("publishes a country at exactly 5 votes", () => {
    expect(build(rows(["LU", 4, 5])).snapshot.countries.LU?.n).toBe(5);
  });

  it("applies the same floor to continents", () => {
    // OC has 4; the world remainder is OC (4) + JP (6) = 10, which is safe.
    const { snapshot } = build(rows(["AU", 1, 4], ["FR", 0, 50], ["US", 0, 50], ["JP", 0, 6]));
    expect(snapshot.continents.OC).toBeUndefined();
    expect(snapshot.continents.EU?.n).toBe(50);
  });
});

describe("buildSnapshot: complementary suppression (decision P3 = A)", () => {
  it("defeats the differencing attack: EU − FR − DE no longer isolates LU's single vote", () => {
    // The exact case that leaked before P3 (ADR 0003): LU's 1 sad vote was recoverable.
    const { snapshot } = build(
      rows(["FR", 0, 40], ["FR", 1, 30], ["DE", 2, 25], ["LU", 4, 1], ["US", 1, 100]),
    );
    expect(snapshot.countries.LU).toBeUndefined();
    expect(snapshot.countries.DE).toBeUndefined(); // the smallest published sibling is hidden too
    expect(snapshot.countries.FR?.n).toBe(70);
    // What an attacker can now isolate is DE + LU together: 26 votes, not 1.
    expect((snapshot.continents.EU?.n ?? 0) - (snapshot.countries.FR?.n ?? 0)).toBe(26);
  });

  it("hides the only published sibling when it alone would expose the rest", () => {
    const { snapshot } = build(rows(["LU", 3, 1], ["FR", 0, 100]));
    expect(snapshot.countries).toEqual({});
    expect(snapshot.continents.EU?.n).toBe(101); // the continent stays: world remainder is 0
  });

  it("protects unknown-country votes at the world level", () => {
    // 2 Tor votes count toward the world only; world − EU − NA would reveal them.
    const { snapshot } = build(rows(["FR", 0, 50], ["US", 1, 60], ["T1", 5, 2]));
    expect(snapshot.continents.EU).toBeUndefined(); // smaller of the two is hidden
    expect(snapshot.continents.NA?.n).toBe(60);
  });

  it("protects countries of a continent that is itself hidden", () => {
    // EU is hidden at world level (world remainder would be 3), but EU − FR would still be
    // derivable from world − NA, so LU (1) must not be exposed through FR either.
    const { snapshot } = build(rows(["FR", 0, 20], ["LU", 4, 1], ["US", 1, 5], ["T1", 0, 3]));
    expect(snapshot.countries.LU).toBeUndefined();
    expect(snapshot.countries.FR).toBeUndefined();
  });
});

describe("buildSnapshot: geography", () => {
  it("counts an unknown country toward the world only", () => {
    const { snapshot, state } = build(rows(["T1", 5, 10]));
    expect(snapshot.world.n).toBe(10);
    expect(state.countries).toEqual({});
    expect(Object.values(state.continents).every((c) => c.n === 0)).toBe(true);
  });

  it("shrinks a small country toward its continent, not the world", () => {
    // Europe is sad, the world is calm; Luxembourg has 2 happy votes.
    const { state } = build(rows(["FR", 4, 500], ["US", 1, 5000], ["LU", 0, 2]));
    const eu = state.continents.EU?.dist ?? [];
    expect(state.countries.LU?.dist).toEqual(
      shrink([2, 0, 0, 0, 0, 0], eu, DEFAULT_CONFIG.shrinkK.country),
    );
    expect(state.countries.LU?.dist[4]).toBeGreaterThan(state.countries.LU?.dist[1] ?? 1);
  });

  it("contains a single troll country: its headline flips, the world's does not", () => {
    const calmWorld = rows(["US", 1, 4000], ["JP", 1, 3000], ["BR", 1, 2000], ["FR", 1, 1000]);
    const { snapshot } = build([...calmWorld, ...rows(["LU", 5, 300])]);
    expect(snapshot.countries.LU?.h).toBe(5); // angry
    expect(snapshot.world.h).toBe(1); // still calm
  });
});

describe("buildSnapshot: over time", () => {
  it("blends with the previous state on the next run", () => {
    const first = build(rows(["FR", 0, 100]));
    const second = build(rows(["FR", 4, 100]), T0 + 300, first.state);
    const sad = second.state.countries.FR?.dist[4] ?? Number.NaN;
    const fresh = build(rows(["FR", 4, 100])).state.countries.FR?.dist[4] ?? Number.NaN;
    expect(sad).toBeGreaterThan(0.1); // moved toward sad...
    expect(sad).toBeLessThan(fresh); // ...but not all the way in one step
  });

  it("returns the previous state unchanged on a duplicate run (dt = 0)", () => {
    const first = build(rows(["FR", 0, 100]));
    const again = build(rows(["FR", 4, 999]), T0, first.state);
    expect(again.state).toBe(first.state);
    expect(again.snapshot).toEqual(first.snapshot);
  });

  it("ignores a clock-skewed run (dt < 0)", () => {
    const first = build(rows(["FR", 0, 100]));
    expect(build(rows(["FR", 4, 999]), T0 - 60, first.state).state).toBe(first.state);
  });

  it("lets an expired country fade toward its continent instead of vanishing", () => {
    const first = build(rows(["LU", 5, 50], ["FR", 0, 500]));
    const later = build(rows(["FR", 0, 500]), T0 + 300, first.state);
    const lu = later.state.countries.LU;
    expect(lu?.n).toBe(0);
    expect(lu?.dist[5]).toBeLessThan(first.state.countries.LU?.dist[5] ?? 0);
    expect(later.snapshot.countries.LU).toBeUndefined(); // n = 0 is below the floor
  });

  it("drops a country that is no longer in the map", () => {
    const first = build(rows(["FR", 0, 10]));
    const smallerMap = new Map([...GEO].filter(([code]) => code !== "FR"));
    const later = buildSnapshot({
      counts: [],
      countryToContinent: smallerMap,
      now: T0 + 300,
      previousState: first.state,
    });
    expect(later.state.countries.FR).toBeUndefined();
  });
});

describe("buildSnapshot: invariants over random input", () => {
  const rowsArb = fc.array(voteCountArb, { maxLength: 40 });

  it("always produces a snapshot and state that pass their own schemas", () => {
    fc.assert(
      fc.property(rowsArb, rowsArb, fc.integer({ min: 1, max: 7200 }), (r1, r2, dt) => {
        const a = build(r1);
        const b = build(r2, T0 + dt, a.state);
        for (const out of [a, b]) {
          const s = parseSnapshot(JSON.parse(JSON.stringify(out.snapshot)));
          const st = parseAggregatorState(JSON.parse(JSON.stringify(out.state)));
          expect(s.ok ? "ok" : s.error).toBe("ok");
          expect(st.ok ? "ok" : st.error).toBe("ok");
        }
      }),
    );
  });

  it("never leaves a hidden remainder between 1 and floor − 1 beside a published sibling", () => {
    // Differencing needs at least one published child to subtract. With none published, the
    // remainder is the parent's own total (the world is always published; ADR 0003).
    const f = DEFAULT_CONFIG.publishMinN;
    const safe = (parentN: number, kids: number[]) => {
      if (kids.length === 0) return true;
      const remainder = parentN - kids.reduce((a, b) => a + b, 0);
      return remainder === 0 || remainder >= f;
    };
    fc.assert(
      fc.property(rowsArb, (r) => {
        const { snapshot, state } = build(r);
        expect(
          safe(
            state.world.n,
            Object.values(snapshot.continents).map((c) => c.n),
          ),
        ).toBe(true);
        for (const [c, region] of Object.entries(state.continents)) {
          const kids = Object.entries(snapshot.countries).filter(([code]) => GEO.get(code) === c);
          expect(
            safe(
              region.n,
              kids.map(([, k]) => k.n),
            ),
          ).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never publishes a region below the floor", () => {
    fc.assert(
      fc.property(rowsArb, (r) => {
        const { snapshot } = build(r);
        for (const region of [
          ...Object.values(snapshot.continents),
          ...Object.values(snapshot.countries),
        ]) {
          expect(region.n).toBeGreaterThanOrEqual(DEFAULT_CONFIG.publishMinN);
        }
      }),
    );
  });

  it("is deterministic and independent of row order (byte-identical JSON)", () => {
    fc.assert(
      fc.property(rowsArb, fc.array(fc.double({ noNaN: true })), (r, keys) => {
        const shuffled = r
          .map((row, i) => ({ row, key: keys[i % Math.max(keys.length, 1)] ?? i }))
          .sort((x, y) => x.key - y.key)
          .map((x) => x.row);
        expect(JSON.stringify(build(shuffled).snapshot)).toBe(JSON.stringify(build(r).snapshot));
      }),
    );
  });
});
