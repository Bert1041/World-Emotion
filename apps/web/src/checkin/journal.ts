import { MOOD_COUNT, type MoodId } from "@world-emotion/shared";

/**
 * Your own check-ins, kept on this device and never sent anywhere (bridge R2, decision B3). One
 * entry per calendar day (the day's last mood), newest last, at most JOURNAL_MAX days. It is the
 * one thing the app accumulates that is yours.
 */
export interface JournalEntry {
  /** Local calendar day, "YYYY-MM-DD". */
  readonly day: string;
  readonly mood: MoodId;
  /** When (ms since epoch): kept for ordering within the day. */
  readonly at: number;
  readonly country: string;
}

export const JOURNAL_KEY = "we.journal";
export const JOURNAL_MAX = 30;
/** The strip shows this many days, today last. */
export const WEEK = 7;

const pad = (n: number) => String(n).padStart(2, "0");
/** The local calendar day of a moment. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Add a check-in: replaces the same day's entry, keeps days in order, drops the oldest past the cap. */
export function addEntry(
  entries: readonly JournalEntry[],
  e: { mood: MoodId; at: Date; country: string },
): JournalEntry[] {
  const day = dayKey(e.at);
  const next = entries.filter((x) => x.day !== day);
  next.push({ day, mood: e.mood, at: e.at.getTime(), country: e.country });
  next.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return next.slice(-JOURNAL_MAX);
}

/** What was saved, keeping only well-formed entries (storage can be edited or corrupt). */
export function parseJournal(raw: string | null): JournalEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const byDay = new Map<string, JournalEntry>();
  for (const x of data as Partial<JournalEntry>[]) {
    if (
      x !== null &&
      typeof x === "object" &&
      typeof x.day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(x.day) &&
      Number.isInteger(x.mood) &&
      (x.mood as number) >= 0 &&
      (x.mood as number) < MOOD_COUNT &&
      typeof x.at === "number" &&
      Number.isFinite(x.at) &&
      typeof x.country === "string"
    )
      byDay.set(x.day, { day: x.day, mood: x.mood as MoodId, at: x.at, country: x.country });
  }
  return [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-JOURNAL_MAX);
}

/** The last WEEK calendar days ending today, oldest first: the day's mood, or null for no check-in. */
export function lastWeek(entries: readonly JournalEntry[], today: Date): (MoodId | null)[] {
  const byDay = new Map(entries.map((e) => [e.day, e.mood]));
  const out: (MoodId | null)[] = [];
  for (let back = WEEK - 1; back >= 0; back--) {
    // Calendar arithmetic, not 24 h steps: a daylight-saving day is 23 or 25 hours long.
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    out.push(byDay.get(dayKey(d)) ?? null);
  }
  return out;
}

export interface JournalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): JournalStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadJournal(store: JournalStore | null = storage()): JournalEntry[] {
  try {
    return parseJournal(store?.getItem(JOURNAL_KEY) ?? null);
  } catch {
    return [];
  }
}

export function saveJournal(
  entries: readonly JournalEntry[],
  store: JournalStore | null = storage(),
): void {
  try {
    if (entries.length === 0) store?.removeItem(JOURNAL_KEY);
    else store?.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    // a per-device convenience only
  }
}
