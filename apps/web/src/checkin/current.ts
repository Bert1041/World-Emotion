import { MOOD_COUNT, type MoodId } from "@world-emotion/shared";

/**
 * Your current check-in, remembered on this device for as long as it counts (the server's window,
 * 6 hours), so a reload shows "You feel …" instead of asking again. Before this the mood lived in
 * memory only: on the real site a reload looked like a lost check-in, though the server held the
 * vote (reported 2026-11-22). Separate from the journal, so clearing the journal does not hide a
 * live check-in. A per-device convenience; never sent anywhere.
 */
export const CURRENT_KEY = "we.current";

export interface Current {
  readonly mood: MoodId;
  /** When it was made, ms. */
  readonly at: number;
}

/** The saved check-in if it is well-formed and still inside the window at `nowMs`. */
export function parseCurrent(raw: string | null, nowMs: number, windowMs: number): Current | null {
  try {
    const c = JSON.parse(raw ?? "null") as { mood?: unknown; at?: unknown } | null;
    if (
      c &&
      Number.isInteger(c.mood) &&
      (c.mood as number) >= 0 &&
      (c.mood as number) < MOOD_COUNT &&
      typeof c.at === "number" &&
      c.at <= nowMs &&
      nowMs - c.at < windowMs
    )
      return { mood: c.mood as MoodId, at: c.at };
  } catch {
    // corrupt: as if nothing was saved
  }
  return null;
}

export function loadCurrent(nowMs: number, windowMs: number): Current | null {
  try {
    return parseCurrent(localStorage.getItem(CURRENT_KEY), nowMs, windowMs);
  } catch {
    return null; // storage blocked
  }
}

export function saveCurrent(c: Current): void {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(c));
  } catch {
    // a convenience only
  }
}
