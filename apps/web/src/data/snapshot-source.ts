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
  /** Your check-in. Counted from the next run on, like the real pipeline (README §5.2). */
  checkIn(country: string, mood: MoodId): void;
  /** Run one aggregation now and return it (tests: force a snapshot at a chosen moment). */
  aggregate(): Snapshot;
  /** Prototype controls, present only on the demo source (the `?dev=1` bar). */
  readonly demo?: DemoControls;
}

export interface DemoControls {
  /** Whether the world's leading mood rotates on its own. */
  readonly autoCycle: boolean;
  /** Steer the world toward a mood and stop the rotation. */
  previewMood(mood: MoodId): void;
  /** Flip the rotation; returns the new state. */
  toggleAuto(): boolean;
}
