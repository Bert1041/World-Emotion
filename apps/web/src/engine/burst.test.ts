import { describe, expect, it } from "vitest";
import { BURST_SIZE, Burst, FLASH_END, flashAmount } from "./burst";
import { rng } from "./particles";

describe("landing burst", () => {
  it("throws sparks outwards, slows them, and is over within its longest life", () => {
    const b = new Burst(rng(2));
    expect(b.active).toBe(false);
    b.fire([10, 20], "#f00");
    expect(b.active).toBe(true);
    expect(b.anchor).toEqual([10, 20]);
    b.update(0.1);
    const d1 = Math.hypot(...b.offset(0));
    b.update(0.1);
    const d2 = Math.hypot(...b.offset(0));
    expect(d1).toBeGreaterThan(0);
    expect(d2 - d1, "slower in the second tenth than the first").toBeLessThan(d1);
    for (let i = 0; i < 16; i++) b.update(0.1);
    expect(b.active).toBe(false);
  });

  it("drag: a spark's sideways speed more than halves in half a second", () => {
    const b = new Burst(rng(6));
    b.fire([0, 0], "#fff");
    const dx = () => {
      const before = b.offset(0)[0];
      b.update(0.05);
      return Math.abs(b.offset(0)[0] - before) / 0.05;
    };
    const early = dx();
    for (let i = 0; i < 9; i++) b.update(0.05);
    const late = dx();
    expect(early).toBeGreaterThan(1);
    expect(late).toBeLessThan(early / 2);
  });

  it("sparks start bright and fade", () => {
    const b = new Burst(rng(4));
    b.fire([0, 0], "#fff");
    b.update(0.01);
    const early = Array.from({ length: BURST_SIZE }, (_, i) => b.alpha(i));
    b.update(0.5);
    const later = Array.from({ length: BURST_SIZE }, (_, i) => b.alpha(i));
    for (let i = 0; i < BURST_SIZE; i++) expect(later[i]).toBeLessThan(early[i] as number);
  });

  it("the country's flash rises fast, peaks, then fades to nothing", () => {
    expect(flashAmount(-0.1)).toBe(0);
    expect(flashAmount(0)).toBe(0);
    expect(flashAmount(0.12)).toBeCloseTo(1);
    expect(flashAmount(0.6)).toBeLessThan(flashAmount(0.3));
    expect(flashAmount(FLASH_END)).toBe(0);
    expect(flashAmount(FLASH_END - 0.01)).toBeLessThan(0.1); // no visible jump at the end
  });
});
