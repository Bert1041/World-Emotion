/**
 * The fixed mood enum. The array index IS the stored integer id, so the order is part of the
 * database contract: reordering or inserting is a migration (docs/decisions/0001).
 */
export const MOODS = ["happy", "calm", "excited", "stressed", "sad", "angry"] as const;

export type MoodName = (typeof MOODS)[number];
export type MoodId = 0 | 1 | 2 | 3 | 4 | 5;

export const MOOD_COUNT = MOODS.length;

/** Every valid id, in order. Kept in lock-step with MOODS by a test. */
export const MOOD_IDS = [0, 1, 2, 3, 4, 5] as const satisfies readonly MoodId[];

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MOOD_COUNT;
}
