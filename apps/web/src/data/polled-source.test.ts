/**
 * PolledSource's own logic, with a scripted fetch so each failure can be produced on demand. The
 * same paths run against the real local server in a real browser in e2e/live.spec.ts.
 */
import { buildSnapshot } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import type { Snapshot } from "@world-emotion/shared";
import { describe, expect, it } from "vitest";
import {
  DEVICE_KEY,
  emptyWorld,
  PENDING_KEY,
  PolledSource,
  SNAPSHOT_CACHE_KEY,
} from "./polled-source";

const snap = (at: number): Snapshot =>
  buildSnapshot({
    counts: [{ country: "CA", mood: 1, n: 10 }],
    countryToContinent: COUNTRY_TO_CONTINENT,
    now: at,
  }).snapshot;

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

type Reply = Response | Error;
/** A fetch that answers from a script and records every call. */
function scripted(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = replies.shift() ?? new Error("script ran out");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = () => new Promise((r) => setTimeout(r, 0));

function source(
  replies: Reply[],
  over: Partial<ConstructorParameters<typeof PolledSource>[0]> = {},
) {
  const s = scripted(replies);
  const storage =
    (over.storage as Storage | undefined) ?? (new MemoryStorage() as unknown as Storage);
  const src = new PolledSource({
    snapshotUrl: "https://cdn.test/snapshot.json",
    apiUrl: "https://api.test",
    fetch: s.fetch,
    storage,
    random: () => 0.5, // no jitter: exactly 45 s
    hidden: () => false,
    ...over,
  });
  return { src, calls: s.calls, storage };
}

/** One frame at `t`, then let the poll finish, then the next frame (which hands over a snapshot). */
async function frame(src: PolledSource, t: number) {
  const first = src.tick(t);
  await settle();
  return first ?? src.tick(t + 16);
}

describe("PolledSource: polling", () => {
  it("starts quiet (dated 0, so any real snapshot is newer), polls at once, then every 45 s", async () => {
    const { src, calls, storage } = source([json(snap(1000)), json(snap(1300))]);
    expect(src.snapshot.world.n).toBe(0);
    expect(src.snapshot.generatedAt).toBe(0);

    expect((await frame(src, 0))?.generatedAt).toBe(1000);
    expect(JSON.parse(storage.getItem(SNAPSHOT_CACHE_KEY) ?? "{}").generatedAt).toBe(1000);
    expect(await frame(src, 44_000), "not yet").toBeNull();
    expect(calls).toHaveLength(1);
    expect((await frame(src, 45_000))?.generatedAt).toBe(1300);
    // Revalidated every time: the browser's 30 s copy must not answer a poll.
    expect(calls.map((c) => c.init?.cache)).toEqual(["no-cache", "no-cache"]);
  });

  it("first paint uses the last snapshot saved on this device", () => {
    const storage = new MemoryStorage() as unknown as Storage;
    storage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snap(777)));
    expect(source([], { storage }).src.snapshot.generatedAt).toBe(777);
  });

  it.each([
    ["a newer version", json({ ...snap(2000), v: 2 })],
    ["a 500", json({ error: "boom" }, 500)],
    ["invalid JSON", new Response("{not json", { status: 200 })],
    ["no network", new TypeError("Failed to fetch")],
  ])("keeps the last good snapshot on %s, and backs off", async (_name, bad) => {
    const { src, calls } = source([json(snap(1000)), bad, bad]);
    await frame(src, 0);
    expect(await frame(src, 45_000)).toBeNull();
    expect(src.snapshot.generatedAt).toBe(1000);
    // After one failure the wait doubles: nothing at +45 s, the next try at +90 s.
    expect(await frame(src, 90_000)).toBeNull();
    expect(calls).toHaveLength(2);
    await frame(src, 135_000);
    expect(calls).toHaveLength(3);
  });

  it("ignores a snapshot that is not newer (a stale CDN copy)", async () => {
    const { src } = source([json(snap(1000)), json(snap(1000)), json(snap(900))]);
    await frame(src, 0);
    expect(await frame(src, 45_000)).toBeNull();
    expect(await frame(src, 90_000)).toBeNull();
    expect(src.snapshot.generatedAt).toBe(1000);
  });

  it("jitter keeps every wait within 45 s ± 15 s", async () => {
    for (const r of [0, 0.999]) {
      const { src, calls } = source([json(snap(1000)), json(snap(1300))], { random: () => r });
      await frame(src, 0);
      await frame(src, 29_000); // the helper ticks again 16 ms later, so stay clear of 30 s
      expect(calls, `random ${r}: not before 30 s`).toHaveLength(1);
      await frame(src, 60_000);
      expect(calls, `random ${r}: by 60 s`).toHaveLength(2);
    }
  });

  it("does not poll while the page is hidden", async () => {
    let hidden = true;
    const { src, calls } = source([json(snap(1000))], { hidden: () => hidden });
    await frame(src, 0);
    await frame(src, 100_000);
    expect(calls).toHaveLength(0);
    hidden = false;
    expect((await frame(src, 100_016))?.generatedAt).toBe(1000);
  });
});

describe("PolledSource: check-ins", () => {
  const answer = { counted: "world", conn: "FR", replay: false };

  it("sends mood, country, a fresh check-in id and one stable device key; returns the answer", async () => {
    const { src, calls, storage } = source([json(answer), json({ ...answer, counted: "country" })]);
    expect(await src.checkIn("NG", 2)).toEqual({ counted: "world", conn: "FR" });
    expect(await src.checkIn("NG", 3)).toEqual({ counted: "country", conn: "FR" });
    const bodies = calls.map((c) => JSON.parse(String(c.init?.body)));
    expect(calls[0]?.url).toBe("https://api.test/checkin");
    expect(bodies[0]).toMatchObject({ mood: 2, country: "NG" });
    expect(bodies[0].deviceKey).toBe(storage.getItem(DEVICE_KEY));
    expect(bodies[1].deviceKey, "same device").toBe(bodies[0].deviceKey);
    expect(bodies[1].checkinId, "new check-in").not.toBe(bodies[0].checkinId);
    expect(storage.getItem(PENDING_KEY), "nothing left to send").toBeNull();
  });

  it("retries once on a network error, then keeps the check-in and sends it on the next start", async () => {
    const offline = new TypeError("Failed to fetch");
    const { src, calls, storage } = source([offline, offline]);
    expect(await src.checkIn("NG", 4)).toBeNull();
    expect(calls).toHaveLength(2);
    const kept = JSON.parse(storage.getItem(PENDING_KEY) ?? "null");
    expect(kept).toMatchObject({ mood: 4, country: "NG" });

    // Next start: the same check-in id goes again, so the server cannot count it twice (G7).
    const again = source([json(answer), json(snap(1000))], { storage });
    await settle();
    expect(JSON.parse(String(again.calls[0]?.init?.body)).checkinId).toBe(kept.checkinId);
    expect(storage.getItem(PENDING_KEY)).toBeNull();
  });

  it("does not retry an answer: a 429 or 400 is kept for later, not hammered", async () => {
    const { src, calls, storage } = source([json({ error: "rate" }, 429)]);
    expect(await src.checkIn("NG", 1)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(storage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("only the latest check-in is kept", async () => {
    const offline = new TypeError("Failed to fetch");
    const { src, storage } = source([offline, offline, offline, offline]);
    await src.checkIn("NG", 1);
    await src.checkIn("NG", 5);
    expect(JSON.parse(storage.getItem(PENDING_KEY) ?? "{}").mood).toBe(5);
  });
});

describe("emptyWorld", () => {
  it("is a valid, quiet snapshot dated 0", () => {
    const e = emptyWorld();
    expect(e.world.n).toBe(0);
    expect(e.generatedAt).toBe(0);
    expect(Object.keys(e.countries)).toEqual([]);
  });
});
