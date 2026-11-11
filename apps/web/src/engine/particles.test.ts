import { describe, expect, it } from "vitest";
import { ParticleField, rng } from "./particles";

const spawn = (pts: number[], mood: number, weight = 1) => ({
  points: new Float32Array(pts),
  mood,
  weight,
});

describe("ParticleField spawning (bridge U2)", () => {
  it("every particle is anchored exactly on one of its region's land points, through many lifetimes", () => {
    const a = spawn([10, 20, 11, 21, 12, 22], 0);
    const b = spawn([-60, -10], 5);
    const f = new ParticleField(300, [a, b], rng(3));
    const allowed = new Set(["10,20,0", "11,21,0", "12,22,0", "-60,-10,5"]);
    for (let step = 0; step < 200; step++) {
      f.update(0.05); // 10 s: every mood's particles respawn several times
      for (const [lon, lat, mood] of f.anchors())
        expect(allowed.has(`${lon},${lat},${mood}`), `${lon},${lat},${mood}`).toBe(true);
    }
  });

  it("uses all of a region's points, not only the first", () => {
    const f = new ParticleField(400, [spawn([1, 1, 2, 2, 3, 3, 4, 4], 1)], rng(5));
    f.update(10);
    const seen = new Set(f.anchors().map(([lon]) => lon));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("spawns in proportion to weight, and nothing with no spawns", () => {
    const f = new ParticleField(1000, [spawn([0, 0], 0, 3), spawn([50, 0], 1, 1)], rng(9));
    const heavy = f.anchors().filter(([lon]) => lon === 0).length;
    expect(heavy / f.anchors().length).toBeGreaterThan(0.65);
    expect(heavy / f.anchors().length).toBeLessThan(0.85);
    expect(new ParticleField(50, [], rng(1)).anchors()).toEqual([]);
  });
});
