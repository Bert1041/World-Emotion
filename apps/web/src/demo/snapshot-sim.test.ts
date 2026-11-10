import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import { describe, expect, it } from "vitest";
import { SnapshotSim } from "./snapshot-sim";

/** Raw active count for one country (the world total is a sum of shrunk data, so use countries). */
const worldN = (sim: SnapshotSim) => sim.snapshot.world.n;

describe("SnapshotSim check-in", () => {
  it("your check-in is counted from the next run, once, and a new one replaces it", () => {
    const a = new SnapshotSim(1);
    const b = new SnapshotSim(1); // control: same seed, no check-in
    a.step();
    b.step();
    a.checkIn("NG", 0);
    expect(worldN(a), "not counted before the next run").toBe(worldN(b));
    a.step();
    b.step();
    expect(worldN(a) - worldN(b), "counted once").toBe(1);
    a.checkIn("NG", 4); // change of mood: still one vote
    a.step();
    b.step();
    expect(worldN(a) - worldN(b), "replaced, not added").toBe(1);
  });

  it("rejects a country the map cannot draw", () => {
    expect(() => new SnapshotSim(1).checkIn("XX", 0)).toThrow(/unknown country/);
  });
});

describe("SnapshotSim with a fixed number of votes", () => {
  it.each([0, 4, 5, 12])("votes: %i gives a world of exactly that many raw check-ins", (votes) => {
    const sim = new SnapshotSim(1, { votes });
    expect(sim.snapshot.world.n).toBe(votes);
    sim.step();
    expect(sim.snapshot.world.n, "stable across runs").toBe(votes);
  });

  it("puts them all in the first country: below the floor at 4, published at 5", () => {
    const [first] = COUNTRY_TO_CONTINENT.keys();
    expect(new SnapshotSim(1, { votes: 4 }).snapshot.countries[first as string]).toBeUndefined();
    const five = new SnapshotSim(1, { votes: 5 }).snapshot;
    expect(five.countries[first as string]?.n).toBe(5);
    expect(Object.keys(five.countries), "no other country").toEqual([first]);
  });
});
