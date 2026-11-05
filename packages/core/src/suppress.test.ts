import { describe, expect, it } from "vitest";
import { publishable } from "./suppress";

const F = 5;
const keys = (s: Set<string>) => [...s].sort();

describe("publishable", () => {
  it("publishes every child at or above the floor when nothing is hidden", () => {
    expect(
      keys(
        publishable(
          30,
          [
            ["A", 10],
            ["B", 20],
          ],
          F,
        ),
      ),
    ).toEqual(["A", "B"]);
  });

  it("keeps everything when the hidden remainder is already safe (>= floor)", () => {
    expect(
      keys(
        publishable(
          35,
          [
            ["A", 10],
            ["B", 20],
            ["C", 5],
          ],
          F,
        ),
      ),
    ).toEqual(["A", "B", "C"]);
    expect(
      keys(
        publishable(
          35,
          [
            ["A", 10],
            ["B", 20],
            ["x", 3],
            ["y", 2],
          ],
          F,
        ),
      ),
    ).toEqual(["A", "B"]);
  });

  it("hides the smallest published child when the remainder is 1..floor-1", () => {
    expect(
      keys(
        publishable(
          31,
          [
            ["A", 10],
            ["B", 20],
            ["x", 1],
          ],
          F,
        ),
      ),
    ).toEqual(["B"]);
  });

  it("hides at exactly floor − 1 and not at floor", () => {
    expect(
      keys(
        publishable(
          34,
          [
            ["A", 10],
            ["B", 20],
            ["x", 4],
          ],
          F,
        ),
      ),
    ).toEqual(["B"]);
    expect(
      keys(
        publishable(
          35,
          [
            ["A", 10],
            ["B", 20],
            ["x", 5],
          ],
          F,
        ),
      ),
    ).toEqual(["A", "B", "x"]);
  });

  it("breaks a tie on size by key, deterministically", () => {
    expect(
      keys(
        publishable(
          21,
          [
            ["B", 10],
            ["A", 10],
            ["x", 1],
          ],
          F,
        ),
      ),
    ).toEqual(["B"]);
  });

  it("treats votes the parent has but no child holds as part of the remainder", () => {
    // e.g. unknown-country votes at world level.
    expect(
      keys(
        publishable(
          22,
          [
            ["A", 10],
            ["B", 10],
          ],
          F,
        ),
      ),
    ).toEqual(["B"]);
  });

  it("returns nothing when no child reaches the floor", () => {
    expect(
      publishable(
        4,
        [
          ["x", 3],
          ["y", 1],
        ],
        F,
      ).size,
    ).toBe(0);
  });

  it("rejects children that exceed the parent (a bug upstream)", () => {
    expect(() => publishable(5, [["A", 6]], F)).toThrow(RangeError);
  });
});
