import { describe, expect, expectTypeOf, it } from "vitest";
import type { MoodId } from "./moods";
import {
  type CheckinRequest,
  checkinRequestSchema,
  parseAggregatorState,
  parseSnapshot,
  type Snapshot,
} from "./schemas";

const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("checkinRequestSchema", () => {
  it("accepts a minimal valid check-in", () => {
    expect(checkinRequestSchema.safeParse({ mood: 0, checkinId: UUID }).success).toBe(true);
  });

  it("accepts a manual country override", () => {
    const r = checkinRequestSchema.safeParse({ mood: 5, country: "CA", checkinId: UUID });
    expect(r.success).toBe(true);
  });

  it.each([
    ["mood out of range", { mood: 6, checkinId: UUID }],
    ["negative mood", { mood: -1, checkinId: UUID }],
    ["fractional mood", { mood: 1.5, checkinId: UUID }],
    ["mood as string", { mood: "1", checkinId: UUID }],
    ["missing checkinId", { mood: 1 }],
    ["non-uuid checkinId", { mood: 1, checkinId: "abc" }],
    ["lower-case country", { mood: 1, country: "ca", checkinId: UUID }],
    ["3-letter country", { mood: 1, country: "CAN", checkinId: UUID }],
    ["unknown key (no free text, ever)", { mood: 1, checkinId: UUID, note: "hi" }],
  ])("rejects %s", (_, input) => {
    expect(checkinRequestSchema.safeParse(input).success).toBe(false);
  });

  it("infers mood as MoodId, not number", () => {
    expectTypeOf<CheckinRequest["mood"]>().toEqualTypeOf<MoodId>();
  });
});

const region = (h: MoodId = 0) => ({ n: 10, dist: [0.5, 0.1, 0.1, 0.1, 0.1, 0.1], h });
const validSnapshot = (): Snapshot => ({
  v: 1,
  generatedAt: 1_700_000_000,
  windowSeconds: 21_600,
  world: region(),
  continents: { EU: region() },
  countries: { FR: region() },
});

describe("parseSnapshot", () => {
  it("accepts a valid v1 snapshot", () => {
    expect(parseSnapshot(validSnapshot()).ok).toBe(true);
  });

  it("accepts rounding error within tolerance", () => {
    const s = validSnapshot();
    s.world.dist = [0.5001, 0.1, 0.1, 0.1, 0.1, 0.1]; // sums to 1.0001
    expect(parseSnapshot(s).ok).toBe(true);
  });

  it("rejects an unknown version so the client keeps its last good snapshot", () => {
    expect(parseSnapshot({ ...validSnapshot(), v: 2 }).ok).toBe(false);
  });

  it.each([
    [
      "dist of wrong length",
      (s: Snapshot) => {
        s.world.dist = [1, 0, 0, 0, 0];
      },
    ],
    [
      "dist not summing to 1",
      (s: Snapshot) => {
        s.world.dist = [0.6, 0.1, 0.1, 0.1, 0.1, 0.1];
      },
    ],
    [
      "negative probability",
      (s: Snapshot) => {
        s.world.dist = [1.1, -0.1, 0, 0, 0, 0];
      },
    ],
    [
      "headline out of range",
      (s: Snapshot) => {
        s.world.h = 9 as MoodId;
      },
    ],
    [
      "unknown continent",
      (s: Snapshot) => {
        (s.continents as Record<string, unknown>).XX = region();
      },
    ],
    [
      "bad country code",
      (s: Snapshot) => {
        s.countries.fra = region();
      },
    ],
    [
      "negative n",
      (s: Snapshot) => {
        s.world.n = -1;
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const s = validSnapshot();
    mutate(s);
    const r = parseSnapshot(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it.each([null, undefined, "{}", 42, []])("rejects non-object %s", (input) => {
    expect(parseSnapshot(input).ok).toBe(false);
  });
});

describe("parseAggregatorState", () => {
  const stateRegion = { n: 0, dist: [1, 0, 0, 0, 0, 0], headline: 0, challenger: null, streak: 0 };
  const state = { v: 1, generatedAt: 1, world: stateRegion, continents: {}, countries: {} };

  it("accepts a valid state", () => expect(parseAggregatorState(state).ok).toBe(true));
  it("rejects an unknown version", () =>
    expect(parseAggregatorState({ ...state, v: 2 }).ok).toBe(false));
  it("rejects a negative streak", () => {
    const bad = { ...state, world: { ...stateRegion, streak: -1 } };
    expect(parseAggregatorState(bad).ok).toBe(false);
  });
});
