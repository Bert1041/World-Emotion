import { buildSnapshot } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import {
  type CheckinRequest,
  checkinResponseSchema,
  type MoodId,
  parseSnapshot,
  type Snapshot,
} from "@world-emotion/shared";
import type { CheckinOutcome, SnapshotSource } from "./snapshot-source";

/** Device storage keys (all per-device conveniences; the device key is the API's "one vote"). */
export const SNAPSHOT_CACHE_KEY = "we.snapshot";
export const DEVICE_KEY = "we.device";
export const PENDING_KEY = "we.pendingCheckin";

export interface PolledOptions {
  readonly snapshotUrl: string;
  /** The API's origin; check-ins go to `${apiUrl}/checkin`. */
  readonly apiUrl: string;
  readonly fetch?: typeof fetch;
  readonly storage?: Storage | null;
  readonly random?: () => number;
  /** Whether the page is in the background: no polling then (no cost for hidden tabs). */
  readonly hidden?: () => boolean;
  /** Decision L4: 45 s ± 15 s. */
  readonly intervalMs?: number;
  readonly jitterMs?: number;
  /** After failures the wait doubles from `intervalMs`, up to this. */
  readonly maxBackoffMs?: number;
}

type Pending = Pick<CheckinRequest, "mood" | "country" | "checkinId">;

/**
 * Real data (docs/design/phase-6-live-data.md §3): polls `snapshot.json` and sends check-ins to the
 * API. Never fails loudly: a bad version, an error status, invalid JSON or no network keeps the
 * last good snapshot (README §6; ADR 0006, degrade-not-die) and backs off.
 */
export class PolledSource implements SnapshotSource {
  snapshot: Snapshot;
  private readonly o: Required<Omit<PolledOptions, "storage">> & { storage: Storage | null };
  private arrived: Snapshot | null = null;
  private nextAt = 0;
  private inflight = false;
  private failures = 0;

  constructor(opts: PolledOptions) {
    this.o = {
      fetch: (...a) => globalThis.fetch(...a),
      storage: safeStorage(),
      random: Math.random,
      hidden: () => typeof document !== "undefined" && document.hidden,
      intervalMs: 45_000,
      jitterMs: 15_000,
      maxBackoffMs: 300_000,
      ...opts,
    };
    this.snapshot = this.cached() ?? emptyWorld();
    const pending = this.read(PENDING_KEY);
    if (pending !== null) void this.resend(pending);
  }

  tick(nowMs: number): Snapshot | null {
    if (this.arrived !== null) {
      const s = this.arrived;
      this.arrived = null;
      return s;
    }
    if (!this.inflight && nowMs >= this.nextAt && !this.o.hidden()) void this.poll(nowMs);
    return null;
  }

  /** Tests: poll on the next frame. Returns what is current now (the poll is asynchronous). */
  aggregate(): Snapshot {
    this.nextAt = 0;
    return this.snapshot;
  }

  async checkIn(country: string, mood: MoodId): Promise<CheckinOutcome | null> {
    const pending: Pending = { mood, country, checkinId: crypto.randomUUID() };
    // Kept until the API answers: only the latest check-in is ever kept (README G7).
    this.write(PENDING_KEY, JSON.stringify(pending));
    return this.send(pending);
  }

  private async resend(raw: string): Promise<void> {
    try {
      const p = JSON.parse(raw) as Pending;
      if (typeof p.checkinId === "string" && typeof p.mood === "number") await this.send(p);
    } catch {
      this.remove(PENDING_KEY);
    }
  }

  /** One retry on a network error; never on an answer (a 4xx will not change on retry). */
  private async send(p: Pending): Promise<CheckinOutcome | null> {
    const body: CheckinRequest = { ...p, deviceKey: this.deviceKey() };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.o.fetch(`${this.o.apiUrl}/checkin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        continue; // offline or the network dropped: try once more, then keep it
      }
      if (!res.ok) return null; // rejected or rate-limited: kept, sent with the next one
      const parsed = checkinResponseSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return null;
      // Only clear what we sent: a newer check-in may have replaced it meanwhile.
      if (this.read(PENDING_KEY)?.includes(p.checkinId)) this.remove(PENDING_KEY);
      return { counted: parsed.data.counted, conn: parsed.data.conn };
    }
    return null;
  }

  private async poll(nowMs: number): Promise<void> {
    this.inflight = true;
    let ok = false;
    try {
      // Always ask: the file says max-age=30 for the CDN, and the browser's own copy would
      // otherwise answer a poll (or a forced one) with an old snapshot for up to 30 s. An
      // unchanged file costs a 304 from the edge.
      const res = await this.o.fetch(this.o.snapshotUrl, { cache: "no-cache" });
      if (res.ok) {
        const parsed = parseSnapshot(await res.json());
        if (parsed.ok) {
          ok = true;
          if (parsed.value.generatedAt > this.snapshot.generatedAt) {
            this.snapshot = parsed.value;
            this.arrived = parsed.value;
            this.write(SNAPSHOT_CACHE_KEY, JSON.stringify(parsed.value));
          }
        }
      }
    } catch {
      // network error or invalid JSON: keep the last good snapshot
    } finally {
      this.failures = ok ? 0 : this.failures + 1;
      this.nextAt = nowMs + this.delay();
      this.inflight = false;
    }
  }

  private delay(): number {
    const { intervalMs, jitterMs, maxBackoffMs, random } = this.o;
    if (this.failures === 0) return intervalMs + (random() * 2 - 1) * jitterMs;
    return Math.min(maxBackoffMs, intervalMs * 2 ** this.failures);
  }

  private cached(): Snapshot | null {
    const raw = this.read(SNAPSHOT_CACHE_KEY);
    if (raw === null) return null;
    try {
      const parsed = parseSnapshot(JSON.parse(raw));
      return parsed.ok ? parsed.value : null;
    } catch {
      return null;
    }
  }

  private deviceKey(): string {
    const saved = this.read(DEVICE_KEY);
    if (saved !== null && /^[0-9a-f-]{36}$/.test(saved)) return saved;
    const key = crypto.randomUUID();
    this.write(DEVICE_KEY, key);
    return key;
  }

  private read(k: string): string | null {
    try {
      return this.o.storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }
  private write(k: string, v: string): void {
    try {
      this.o.storage?.setItem(k, v);
    } catch {
      // full or blocked: everything here is a convenience
    }
  }
  private remove(k: string): void {
    try {
      this.o.storage?.removeItem(k);
    } catch {
      // as above
    }
  }
}

/**
 * The quiet world, before the first snapshot arrives (never demo numbers in production). Dated 0,
 * not now: any real snapshot must count as newer, even one built minutes before this page loaded.
 */
export function emptyWorld(): Snapshot {
  return buildSnapshot({ counts: [], countryToContinent: COUNTRY_TO_CONTINENT, now: 0 }).snapshot;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
