import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isActive, windowBounds } from "./window";

const NOW = 1_700_000_000;
const W = 21_600;

describe("isActive", () => {
  it("includes a vote cast exactly now", () => expect(isActive(NOW, NOW, W)).toBe(true));
  it("includes a vote one second inside the window", () =>
    expect(isActive(NOW - W + 1, NOW, W)).toBe(true));
  it("excludes a vote exactly windowSeconds old", () =>
    expect(isActive(NOW - W, NOW, W)).toBe(false));
  it("excludes a future-dated vote (clock skew)", () =>
    expect(isActive(NOW + 1, NOW, W)).toBe(false));

  it("agrees with the SQL bounds for every timestamp", () => {
    fc.assert(
      fc.property(fc.integer({ min: NOW - 2 * W, max: NOW + W }), (t) => {
        const { after, until } = windowBounds(NOW, W);
        expect(isActive(t, NOW, W)).toBe(t > after && t <= until);
      }),
    );
  });
});
