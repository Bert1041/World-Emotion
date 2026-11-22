import type { MoodId, Snapshot } from "@world-emotion/shared";

/**
 * Where snapshots come from (docs/design/phase-5.5-bridge.md, E2). The frame loop polls `tick` once
 * per frame and never knows whether the data is simulated or fetched. Phase 6 adds a polled source
 * (snapshot.json + the check-in API) as a second implementation; `main.ts` changes one constructor.
 */
export interface SnapshotSource {
  /** The latest snapshot. Available synchronously from construction, so the first paint has data. */
  readonly snapshot: Snapshot;
  /** Called every frame with the frame timestamp (ms). Returns a new snapshot when one has arrived. */
  tick(nowMs: number): Snapshot | null;
  /**
   * Your check-in, counted from the next run on (README §5.2). Resolves to where it counted, or
   * null if it could not be delivered yet (it stays on the device and goes with the next one).
   */
  checkIn(country: string, mood: MoodId): Promise<CheckinOutcome | null>;
  /**
   * "Now" on the clock this source's snapshots are dated with (unix seconds): the wall clock for
   * real data, the simulated clock for the demo (which runs five minutes per step).
   */
  now(): number;
  /** Run one aggregation now and return it (tests: force a snapshot at a chosen moment). */
  aggregate(): Snapshot;
  /** Prototype controls, present only on the demo source (the `?dev=1` bar). */
  readonly demo?: DemoControls;
  /** A check-in is kept on the device, not yet delivered (real data only). */
  readonly hasPending?: boolean;
  /** Try the kept check-in again; resolves like `checkIn` (null: still not delivered). */
  resendPending?(): Promise<CheckinOutcome | null>;
}

/** The API's answer (README §5.6): a vote counts for a country only if the connection is there. */
export interface CheckinOutcome {
  readonly counted: "country" | "world";
  /** The connection's country, when known. */
  readonly conn: string | null;
}

export interface DemoControls {
  /** Whether the world's leading mood rotates on its own. */
  readonly autoCycle: boolean;
  /** Steer the world toward a mood and stop the rotation. */
  previewMood(mood: MoodId): void;
  /** Flip the rotation; returns the new state. */
  toggleAuto(): boolean;
}
