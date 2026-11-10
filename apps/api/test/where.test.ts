import { describe, expect, it } from "vitest";
import { connection, place } from "../src/where";

describe("connection country", () => {
  it.each([
    ["CA", { conn: "CA", unrecognised: null }],
    ["XK", { conn: "XK", unrecognised: null }], // Kosovo: in our set (geo-decisions G5)
    ["XX", { conn: null, unrecognised: null }], // unknown: documented, not logged
    ["T1", { conn: null, unrecognised: null }], // Tor: documented, not logged
    ["QZ", { conn: null, unrecognised: "QZ" }], // not ours: logged so we learn about it
    [undefined, { conn: null, unrecognised: null }],
    ["", { conn: null, unrecognised: null }],
  ])("%s → %j", (cf, want) => {
    expect(connection(cf)).toEqual(want);
  });
});

describe("where a vote counts (README §5.6)", () => {
  it.each([
    [undefined, "CA", { stored: "CA", counted: "country" }],
    ["CA", "CA", { stored: "CA", counted: "country" }],
    ["US", "CA", { stored: null, counted: "world" }], // Canadian picking the US
    ["US", null, { stored: null, counted: "world" }], // unknown connection
    [undefined, null, { stored: null, counted: "world" }],
  ] as const)("picked %s, connection %s → %j", (picked, conn, want) => {
    expect(place(picked, conn)).toEqual(want);
  });
});
