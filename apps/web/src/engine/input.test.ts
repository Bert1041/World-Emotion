import { describe, expect, it } from "vitest";
import { MAX_FLING_DEG_S, releaseVelocity, VELOCITY_WINDOW_MS } from "./input";

describe("releaseVelocity", () => {
  it("is zero with no moves, and after a pause longer than the window", () => {
    expect(releaseVelocity([], 1000)).toEqual([0, 0]);
    const old = [{ t: 1000 - VELOCITY_WINDOW_MS - 1, dLon: 10, dLat: 0 }];
    expect(releaseVelocity(old, 1000)).toEqual([0, 0]);
  });

  it("averages the moves inside the window, not the last pair", () => {
    // 5 moves of 2° over 80 ms, then one jittery 0.1° move 1 ms before release.
    const moves = [
      { t: 920, dLon: 2, dLat: 0 },
      { t: 940, dLon: 2, dLat: 0 },
      { t: 960, dLon: 2, dLat: 0 },
      { t: 980, dLon: 2, dLat: 0 },
      { t: 999, dLon: 0.1, dLat: 0 },
    ];
    const [lon] = releaseVelocity(moves, 1000);
    // 8.1° over 80 ms = 101.25°/s; the last pair alone would say 100°/s over 1 ms = 100,000.
    expect(lon).toBeCloseTo(101.25, 2);
  });

  it("never divides by less than one 60 Hz frame", () => {
    const [lon] = releaseVelocity([{ t: 999.9, dLon: 1, dLat: 0 }], 1000);
    expect(lon).toBeCloseTo(60, 5);
  });

  it("caps the speed, keeping the direction", () => {
    const [lon, lat] = releaseVelocity([{ t: 990, dLon: 300, dLat: 400 }], 1000);
    expect(Math.hypot(lon, lat)).toBeCloseTo(MAX_FLING_DEG_S, 6);
    expect(lon / lat).toBeCloseTo(0.75, 6);
  });
});
