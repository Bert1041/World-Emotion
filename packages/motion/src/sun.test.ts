import { describe, expect, it } from "vitest";
import { subsolarPoint } from "./sun";

// Tests may use Date to build instants (the purity lint exempts test files).
const ms = (iso: string) => Date.parse(iso);

describe("subsolarPoint", () => {
  // Published 2024 equinox and solstice instants (UTC): declination 0 / ±23.44°.
  it.each([
    ["2024-03-20T03:06Z", 0],
    ["2024-06-20T20:51Z", 23.44],
    ["2024-09-22T12:44Z", 0],
    ["2024-12-21T09:20Z", -23.44],
  ])("latitude at %s ≈ %f°", (iso, lat) => {
    expect(Math.abs(subsolarPoint(ms(iso))[1] - lat)).toBeLessThan(0.05);
  });

  // Equation of time near its extremes: noon UTC is ~16.4 min early on 3 Nov, ~14.2 late on 11 Feb.
  it.each([
    ["2024-11-03T12:00Z", -4.1],
    ["2024-02-11T12:00Z", 3.55],
  ])("longitude at %s ≈ %f°", (iso, lon) => {
    expect(Math.abs(subsolarPoint(ms(iso))[0] - lon)).toBeLessThan(0.3);
  });

  it("moves west 15° per hour and stays in [-180, 180)", () => {
    const a = subsolarPoint(ms("2024-05-01T00:00Z"))[0];
    const b = subsolarPoint(ms("2024-05-01T01:00Z"))[0];
    expect((((a - b) % 360) + 360) % 360).toBeCloseTo(15, 1);
    for (let h = 0; h < 48; h++) {
      const lon = subsolarPoint(ms("2024-05-01T00:00Z") + h * 3_600_000)[0];
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThan(180);
    }
  });
});
