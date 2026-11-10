import { MOOD_COUNT, type MoodId, type Snapshot } from "@world-emotion/shared";
import { SnapshotSim } from "../demo/snapshot-sim";
import type { DemoControls, SnapshotSource } from "./snapshot-source";

export interface DemoOptions {
  /** One aggregation run every this many ms (the real pipeline: 5 min; the demo: 2 s). */
  readonly stepMs?: number;
  /** The world's leading mood moves on every this many ms while `autoCycle` is on. */
  readonly cycleMs?: number;
  readonly autoCycle?: boolean;
  /** Never step on its own (bench runs: frames must compare across runs). `aggregate()` still works. */
  readonly paused?: boolean;
  /** Clock origin for the cycle timer (ms, same clock as `tick`). */
  readonly now?: number;
}

/**
 * Demo data through the real aggregation pipeline, on the frame clock. Owns the timers that used to
 * live in the frame loop, so the loop only asks "anything new?".
 */
export class DemoSource implements SnapshotSource {
  private readonly sim = new SnapshotSim(1);
  private readonly stepMs: number;
  private readonly cycleMs: number;
  private readonly paused: boolean;
  private stepAt = 0;
  private cycleAt: number;
  private cycling: boolean;
  snapshot: Snapshot;
  readonly demo: DemoControls;

  constructor(opts: DemoOptions = {}) {
    this.stepMs = opts.stepMs ?? 2000;
    this.cycleMs = opts.cycleMs ?? 20_000;
    this.paused = opts.paused ?? false;
    this.cycling = opts.autoCycle ?? true;
    this.cycleAt = opts.now ?? 0;
    this.snapshot = this.sim.snapshot;
    this.demo = {
      autoCycle: this.cycling,
      previewMood: (mood) => {
        this.sim.bias = mood;
        this.setCycling(false);
      },
      toggleAuto: () => {
        this.setCycling(!this.cycling);
        this.cycleAt = this.stepAt;
        return this.cycling;
      },
    };
  }

  private setCycling(on: boolean): void {
    this.cycling = on;
    // `demo` is a plain object the UI reads; keep its field in step.
    (this.demo as { autoCycle: boolean }).autoCycle = on;
  }

  tick(nowMs: number): Snapshot | null {
    if (this.paused || nowMs - this.stepAt <= this.stepMs) return null;
    this.stepAt = nowMs;
    if (this.cycling && nowMs - this.cycleAt > this.cycleMs) {
      this.cycleAt = nowMs;
      this.sim.bias = ((this.sim.bias + 1) % MOOD_COUNT) as MoodId;
    }
    return this.aggregate();
  }

  checkIn(country: string, mood: MoodId): void {
    this.sim.checkIn(country, mood);
  }

  aggregate(): Snapshot {
    this.snapshot = this.sim.step();
    return this.snapshot;
  }
}
