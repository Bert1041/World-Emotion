import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DURATION } from "@world-emotion/motion";
import { describe, expect, it } from "vitest";

/**
 * README §8.3: one set of motion tokens. CSS transitions read the variables in index.html; canvas
 * animations read packages/motion. This keeps the two copies equal, in both directions.
 */
const html = readFileSync(join(import.meta.dirname, "../../index.html"), "utf8");
const cssVars = new Map(
  [...html.matchAll(/--(\w+):\s*(\d+(?:\.\d+)?)ms;/g)].map((m) => [m[1], Number(m[2]) / 1000]),
);

describe("motion tokens", () => {
  it("every CSS duration variable equals its motion token", () => {
    expect(cssVars.size).toBeGreaterThan(0);
    for (const [name, seconds] of cssVars) {
      expect(DURATION, `--${name} has no token in packages/motion`).toHaveProperty(name as string);
      expect(DURATION[name as keyof typeof DURATION], `--${name}`).toBe(seconds);
    }
  });

  it("the UI tokens all exist as CSS variables", () => {
    for (const name of ["fast", "base", "slow"] as const)
      expect(cssVars.get(name), `--${name} missing from index.html`).toBe(DURATION[name]);
  });

  it("CSS uses the same out-curve as packages/motion easeOut", () => {
    const curves = new Set([...html.matchAll(/cubic-bezier\(([^)]+)\)/g)].map((m) => m[1]));
    expect([...curves]).toEqual([".2, .8, .2, 1"]);
  });
});
