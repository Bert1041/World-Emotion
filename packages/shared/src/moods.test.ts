import { describe, expect, expectTypeOf, it } from "vitest";
import { isMoodId, MOOD_COUNT, MOOD_IDS, MOODS, type MoodId } from "./moods";

describe("moods", () => {
  it("is the launch set from ADR 0001, in database order", () => {
    // Changing this order changes what stored integers mean: it must be a migration.
    expect(MOODS).toEqual(["happy", "calm", "excited", "stressed", "sad", "angry"]);
  });

  it("keeps MOOD_IDS in lock-step with MOODS", () => {
    expect(MOOD_IDS).toEqual(MOODS.map((_, i) => i));
    expect(MOOD_COUNT).toBe(6);
  });

  it.each([0, 5])("accepts boundary id %d", (id) => expect(isMoodId(id)).toBe(true));
  it.each([-1, 6, 1.5, Number.NaN, "1", null, undefined])("rejects %s", (v) =>
    expect(isMoodId(v)).toBe(false),
  );

  it("narrows to MoodId", () => {
    const v: unknown = 3;
    if (isMoodId(v)) expectTypeOf(v).toEqualTypeOf<MoodId>();
  });
});
