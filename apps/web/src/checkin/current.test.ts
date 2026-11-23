import { describe, expect, it } from "vitest";
import { parseCurrent } from "./current";

const HOUR = 3_600_000;
const WINDOW = 6 * HOUR;
const now = 1_800_000_000_000;
const saved = (mood: unknown, at: unknown) => JSON.stringify({ mood, at });

describe("parseCurrent", () => {
  it("restores a check-in made inside the window", () => {
    expect(parseCurrent(saved(3, now - 5 * HOUR), now, WINDOW)).toEqual({
      mood: 3,
      at: now - 5 * HOUR,
    });
  });
  it("forgets one that has expired, exactly at the window like the server", () => {
    expect(parseCurrent(saved(3, now - WINDOW), now, WINDOW)).toBeNull();
    expect(parseCurrent(saved(3, now - 7 * HOUR), now, WINDOW)).toBeNull();
  });
  it.each([
    ["nothing saved", null],
    ["corrupt JSON", "{oops"],
    ["mood out of range", saved(6, now)],
    ["mood not a number", saved("calm", now)],
    ["from the future (clock changed)", saved(1, now + HOUR)],
    ["no time", JSON.stringify({ mood: 1 })],
  ])("reads %s as no check-in", (_n, raw) => {
    expect(parseCurrent(raw, now, WINDOW)).toBeNull();
  });
});
