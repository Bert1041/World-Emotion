import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("ParticleField drawing cost (bridge U2, Pixel bench 2026-11-12)", () => {
  /** Counts canvas calls; drawing is checked for its shape (batched), not its pixels. */
  function countingCtx() {
    const calls = { fill: 0, drawImage: 0, arc: 0, rect: 0 };
    const ctx = {
      globalAlpha: 1,
      fillStyle: "",
      beginPath() {},
      moveTo() {},
      arc: () => void calls.arc++,
      rect: () => void calls.rect++,
      fill: () => void calls.fill++,
      drawImage: () => void calls.drawImage++,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("issues at most two fills per mood and nothing per particle, whatever the count", () => {
    // A document that can make canvases, as in a browser: without it a pre-rendered-sprite
    // drawing path would fall back silently and this test could not see it.
    const offscreen = {
      createRadialGradient: () => ({ addColorStop() {} }),
      beginPath() {},
      arc() {},
      fill() {},
      fillRect() {},
    };
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => offscreen }),
    });
    // Every mood, all on the near side of the globe (lon 0, lat 0 faces the viewer).
    const all = [0, 1, 2, 3, 4, 5].map((m) => spawn([m, 0], m));
    const colors = ["#a", "#b", "#c", "#d", "#e", "#f"];
    for (const count of [60, 600]) {
      const f = new ParticleField(count, all, rng(7));
      const { ctx, calls } = countingCtx();
      f.draw(ctx, [0, 0], 500, 500, 400, colors, 2);
      expect(calls.drawImage, `${count}: per-particle images`).toBe(0);
      expect(calls.fill, `${count}: fills`).toBeLessThanOrEqual(12);
      expect(calls.arc + calls.rect, `${count}: every particle drawn`).toBeGreaterThanOrEqual(
        count,
      );
    }
  });
});

describe("ParticleField halos while dragging (Pixel bench 2026-11-12)", () => {
  it("at halo 0 draws only the cores: half the circles, and no halo fills", () => {
    const soft = [0, 1, 2, 5].map((m) => spawn([m, 0], m)); // the four soft moods
    const colors = ["#a", "#b", "#c", "#d", "#e", "#f"];
    const count = (halo: number) => {
      const c = { arc: 0, fill: 0 };
      const ctx = {
        globalAlpha: 1,
        fillStyle: "",
        beginPath() {},
        moveTo() {},
        rect() {},
        arc: () => void c.arc++,
        fill: () => void c.fill++,
      } as unknown as CanvasRenderingContext2D;
      new ParticleField(200, soft, rng(11)).draw(ctx, [0, 0], 500, 500, 400, colors, 2, halo);
      return c;
    };
    const full = count(1);
    const none = count(0);
    expect(none.arc * 2).toBe(full.arc);
    expect(full.fill - none.fill, "the four halo fills are gone").toBe(4);
  });
});
