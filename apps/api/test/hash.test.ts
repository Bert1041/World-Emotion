import { describe, expect, it } from "vitest";
import { ipKey, voterHash } from "../src/hash";

const DAY = 86_400_000;
const noon = Date.UTC(2026, 10, 10, 12);

describe("keyed hashes", () => {
  it("a device always maps to the same row, and different devices to different rows", async () => {
    const a = await voterHash("s", "dev-a");
    expect(await voterHash("s", "dev-a")).toBe(a);
    expect(await voterHash("s", "dev-b")).not.toBe(a);
    expect(await voterHash("other-secret", "dev-a")).not.toBe(a);
  });

  it("an IP's key is stable within a UTC day and changes the next day (README §5.6)", async () => {
    const k = await ipKey("s", "203.0.113.9", noon);
    expect(await ipKey("s", "203.0.113.9", noon + 11 * 3_600_000)).toBe(k); // 23:00 same day
    expect(await ipKey("s", "203.0.113.9", noon + DAY)).not.toBe(k);
    expect(await ipKey("s", "203.0.113.10", noon)).not.toBe(k);
  });

  it("device and IP keys never collide for the same input text", async () => {
    expect(await voterHash("s", "x")).not.toBe(await ipKey("s", "x", noon));
  });
});
