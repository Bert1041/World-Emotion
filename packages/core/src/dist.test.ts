import { describe, expect, it } from "vitest";
import { at, leader } from "./dist";

describe("leader", () => {
  it("picks the maximum", () => expect(leader([0.1, 0.5, 0.1, 0.1, 0.1, 0.1])).toBe(1));
  it("breaks an exact tie by lowest id", () => expect(leader([0, 0.5, 0, 0.5, 0, 0])).toBe(1));
  it("keeps the preferred mood when it is among the tied", () =>
    expect(leader([0, 0.5, 0, 0.5, 0, 0], 3)).toBe(3));
  it("ignores the preference when it is not tied", () =>
    expect(leader([0, 0.5, 0, 0.4, 0, 0], 3)).toBe(1));
  it("treats float noise below EPSILON as a tie", () =>
    expect(leader([0, 0.5 + 1e-15, 0, 0.5, 0, 0], 3)).toBe(3));
  it("picks happy for a uniform distribution", () =>
    expect(leader(new Array(6).fill(1 / 6))).toBe(0));
});

describe("at", () => {
  it("throws instead of returning undefined", () =>
    expect(() => at([1, 2], 2)).toThrow(RangeError));
});
