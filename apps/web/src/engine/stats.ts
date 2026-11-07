/** Fixed-capacity frame recorder: no allocation while recording. */
export class FrameRecorder {
  private readonly interval: Float64Array;
  private readonly script: Float64Array;
  private readonly base: Float64Array;
  private readonly fx: Float64Array;
  private n = 0;

  constructor(capacity: number) {
    this.interval = new Float64Array(capacity);
    this.script = new Float64Array(capacity);
    this.base = new Float64Array(capacity);
    this.fx = new Float64Array(capacity);
  }

  push(intervalMs: number, scriptMs: number, baseMs = 0, fxMs = 0): void {
    if (this.n >= this.interval.length) return;
    this.interval[this.n] = intervalMs;
    this.script[this.n] = scriptMs;
    this.base[this.n] = baseMs;
    this.fx[this.n] = fxMs;
    this.n++;
  }

  get length(): number {
    return this.n;
  }

  summary(expectedIntervalMs: number): FrameSummary & { baseP50: number; fxP50: number } {
    return {
      ...summarize(
        this.interval.subarray(0, this.n),
        this.script.subarray(0, this.n),
        expectedIntervalMs,
      ),
      baseP50: percentile(this.base.subarray(0, this.n), 50),
      fxP50: percentile(this.fx.subarray(0, this.n), 50),
    };
  }
}

export interface FrameSummary {
  frames: number;
  intervalP50: number;
  intervalP95: number;
  intervalP99: number;
  scriptP50: number;
  scriptP95: number;
  /** Frames the loop missed, estimated from intervals longer than 1.5 × the refresh interval. */
  missed: number;
  missedRatio: number;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = Float64Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

export function summarize(
  interval: ArrayLike<number>,
  script: ArrayLike<number>,
  expectedIntervalMs: number,
): FrameSummary {
  let missed = 0;
  for (let i = 0; i < interval.length; i++) {
    const v = interval[i] as number;
    if (v > expectedIntervalMs * 1.5) missed += Math.round(v / expectedIntervalMs) - 1;
  }
  return {
    frames: interval.length,
    intervalP50: percentile(interval, 50),
    intervalP95: percentile(interval, 95),
    intervalP99: percentile(interval, 99),
    scriptP50: percentile(script, 50),
    scriptP95: percentile(script, 95),
    missed,
    missedRatio: interval.length === 0 ? 0 : missed / (interval.length + missed),
  };
}
