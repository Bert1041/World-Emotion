import { describe, expect, it } from "vitest";
import { parseSavedPin } from "./saved-pin";

const known = new Map([
  ["NG", 1],
  ["FR", 1],
]);

describe("parseSavedPin", () => {
  it("accepts a well-formed pin for a country we can draw", () => {
    const raw = JSON.stringify({ code: "NG", lon: 8.6, lat: 9.1 });
    expect(parseSavedPin(raw, known)).toEqual({ code: "NG", lonLat: [8.6, 9.1] });
  });

  it.each([
    ["nothing saved", null],
    ["corrupt JSON", "{not json"],
    ["unknown country", JSON.stringify({ code: "ZZ", lon: 0, lat: 0 })],
    ["code not a string", JSON.stringify({ code: 7, lon: 0, lat: 0 })],
    ["missing coordinates", JSON.stringify({ code: "FR" })],
    ["latitude off the globe", JSON.stringify({ code: "FR", lon: 2, lat: 91 })],
    ["a string, not an object", JSON.stringify("FR")],
  ])("falls back to the guess on %s", (_name, raw) => {
    expect(parseSavedPin(raw, known)).toBeNull();
  });
});
