import type { Oklab } from "@world-emotion/motion";
import { describe, expect, it } from "vitest";
import { FillWave, waveDelays } from "./fill-wave";

const PLAIN: Oklab = [0.5, 0, 0];
const RED: Oklab = [0.6, 0.2, 0.1];

describe("arrival wave", () => {
  it("near countries start first; the far side starts `spread` seconds later", () => {
    const d = waveDelays(
      [0, 0],
      new Map([
        ["HERE", [0, 0]],
        ["NEAR", [10, 0]],
        ["FAR", [180, 0]],
      ]),
      2,
    );
    expect(d.get("HERE")).toBeCloseTo(0);
    expect(d.get("NEAR")).toBeCloseTo(2 * (10 / 180));
    expect(d.get("FAR")).toBeCloseTo(2);
  });

  it("each country goes from plain to its mood once its turn comes; finish ends it", () => {
    const w = new FillWave(
      PLAIN,
      new Map([
        ["A", 0],
        ["B", 1],
      ]),
      0.5,
    );
    const target = new Map([
      ["A", RED],
      ["B", RED],
      ["C", RED],
    ]);
    expect(w.colours(target).get("A")).toEqual(PLAIN);
    w.step(0.5);
    expect(w.colours(target).get("A")).toEqual(RED);
    expect(w.colours(target).get("B"), "not its turn yet").toEqual(PLAIN);
    expect(w.colours(target).get("C"), "not in the wave: as is").toEqual(RED);
    expect(w.running).toBe(true);
    w.finish();
    expect(w.running).toBe(false);
    expect(w.colours(target).get("B")).toEqual(RED);
  });
});
