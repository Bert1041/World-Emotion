import { describe, expect, it } from "vitest";
import {
  addEntry,
  dayKey,
  JOURNAL_KEY,
  JOURNAL_MAX,
  type JournalEntry,
  type JournalStore,
  lastWeek,
  loadJournal,
  parseJournal,
  saveJournal,
} from "./journal";

/** Local noon on a day of November 2026 (local time, as the journal sees days). */
const nov = (d: number, h = 12) => new Date(2026, 10, d, h);
const add = (list: readonly JournalEntry[], d: Date, mood: 0 | 1 | 2 | 3 | 4 | 5) =>
  addEntry(list, { mood, at: d, country: "NG" });

describe("addEntry", () => {
  it("keeps one entry per calendar day: the day's last mood", () => {
    let j = add([], nov(10, 9), 3);
    j = add(j, nov(10, 22), 1);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ day: "2026-11-10", mood: 1, country: "NG" });
    j = add(j, nov(11, 0), 4); // just past midnight is a new day
    expect(j.map((e) => e.day)).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("keeps days in order even when an older day arrives late, and does not mutate its input", () => {
    const a = add([], nov(12), 0);
    const b = add(a, nov(10), 5);
    expect(b.map((e) => e.day)).toEqual(["2026-11-10", "2026-11-12"]);
    expect(a).toHaveLength(1);
  });

  it(`keeps the newest ${JOURNAL_MAX} days`, () => {
    let j: JournalEntry[] = [];
    for (let d = 1; d <= JOURNAL_MAX + 5; d++) j = add(j, new Date(2026, 0, d, 12), 2);
    expect(j).toHaveLength(JOURNAL_MAX);
    expect(j[0]?.day).toBe("2026-01-06");
    expect(j.at(-1)?.day).toBe(dayKey(new Date(2026, 0, JOURNAL_MAX + 5)));
  });
});

describe("lastWeek", () => {
  it("is seven days ending today, oldest first, null where there was no check-in", () => {
    let j = add([], nov(4), 0);
    j = add(j, nov(8), 3);
    j = add(j, nov(10), 1);
    expect(lastWeek(j, nov(10, 23))).toEqual([0, null, null, null, 3, null, 1]);
    expect(lastWeek(j, nov(11, 1)), "a day later the window moves").toEqual([
      null,
      null,
      null,
      3,
      null,
      1,
      null,
    ]);
  });

  it("steps by calendar day across a daylight-saving change and a month end", () => {
    // 29 March 2026 is 23 hours long in Paris; 24 h steps would repeat a day. The machine's own
    // zone may have no daylight saving (Lagos has none), so the test names its zone.
    const zone = process.env.TZ;
    process.env.TZ = "Europe/Paris";
    try {
      expect(new Date(2026, 2, 29, 12).getTimezoneOffset(), "zone applied").toBe(-120);
      weekAcrossSpringForward();
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  function weekAcrossSpringForward(): void {
    let j = addEntry([], { mood: 2, at: new Date(2026, 2, 28, 12), country: "FR" });
    j = addEntry(j, { mood: 4, at: new Date(2026, 3, 1, 12), country: "FR" });
    expect(lastWeek(j, new Date(2026, 3, 1, 0, 30))).toEqual([null, null, 2, null, null, null, 4]);
  }
});

describe("parseJournal", () => {
  const good = { day: "2026-11-10", mood: 1, at: 1, country: "NG" };
  it("returns what was saved", () => {
    expect(parseJournal(JSON.stringify([good]))).toEqual([good]);
  });
  it.each([
    ["nothing saved", null],
    ["corrupt JSON", "[{"],
    ["not a list", JSON.stringify({ day: "x" })],
  ])("is empty on %s", (_n, raw) => {
    expect(parseJournal(raw)).toEqual([]);
  });
  it("drops malformed entries, keeps the rest, one per day, in order, capped", () => {
    const raw = JSON.stringify([
      { ...good, day: "2026-11-12" },
      { ...good, mood: 9 },
      { ...good, mood: 1.5 },
      { ...good, day: "yesterday" },
      { ...good, at: "noon" },
      { ...good, country: 7 },
      null,
      "x",
      { ...good, day: "2026-11-11", mood: 2 },
      { ...good, day: "2026-11-11", mood: 5 }, // same day twice: the later one in the list
    ]);
    expect(parseJournal(raw).map((e) => [e.day, e.mood])).toEqual([
      ["2026-11-11", 5],
      ["2026-11-12", 1],
    ]);
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...good,
      day: `2026-01-${String(i + 1).padStart(2, "0")}`,
    }));
    expect(parseJournal(JSON.stringify(many))).toHaveLength(JOURNAL_MAX);
  });
});

describe("load / save", () => {
  const memory = (): JournalStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };
  it("round-trips, and clearing removes the key entirely", () => {
    const s = memory();
    const j = add(add([], nov(9), 0), nov(10), 3);
    saveJournal(j, s);
    expect(loadJournal(s)).toEqual(j);
    saveJournal([], s);
    expect(s.data.has(JOURNAL_KEY), "nothing left behind").toBe(false);
    expect(loadJournal(s)).toEqual([]);
  });
  it("with no storage, or storage that throws, it is empty and harmless", () => {
    expect(loadJournal(null)).toEqual([]);
    const broken: JournalStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadJournal(broken)).toEqual([]);
    expect(() => saveJournal(add([], nov(10), 1), broken)).not.toThrow();
  });
});
