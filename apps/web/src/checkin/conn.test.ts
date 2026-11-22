import { describe, expect, it } from "vitest";
import { parseConn } from "./conn";

const known = new Map([
  ["NG", 1],
  ["FR", 1],
]);

describe("parseConn", () => {
  it("accepts a country we can draw", () => {
    expect(parseConn("NG", known)).toBe("NG");
  });
  it.each([
    ["nothing saved", null],
    ["unknown code", "ZZ"],
    ["Cloudflare's 'unknown'", "XX"],
    ["lower case", "ng"],
    ["junk", '{"code":"NG"}'],
  ])("reads %s as unknown", (_n, raw) => {
    expect(parseConn(raw, known)).toBeNull();
  });
});
