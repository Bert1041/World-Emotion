/**
 * The check-in landing's burst (Phase 6.5, V6): sparks of your mood thrown out from where your
 * face lands, slowing and fading over about a second. Fixed pool, typed arrays, no allocation in
 * the frame loop (README §8.1). Offsets are relative to the landing point, which the caller
 * projects each frame, so the burst stays on your country while the globe turns.
 */
export const BURST_SIZE = 56;
/** Velocity decays by this factor per second (exponential drag). */
const DRAG = 0.04;
/** CSS px per second at launch, slowest and fastest. */
const SPEED: readonly [number, number] = [70, 260];
const LIFE: readonly [number, number] = [0.7, 1.5];

export class Burst {
  private readonly x = new Float32Array(BURST_SIZE);
  private readonly y = new Float32Array(BURST_SIZE);
  private readonly vx = new Float32Array(BURST_SIZE);
  private readonly vy = new Float32Array(BURST_SIZE);
  private readonly age = new Float32Array(BURST_SIZE);
  private readonly life = new Float32Array(BURST_SIZE);
  private readonly size = new Float32Array(BURST_SIZE);
  private live = 0;
  anchor: readonly [number, number] = [0, 0];
  color = "#fff";

  constructor(private readonly rng: () => number) {}

  get active(): boolean {
    return this.live > 0;
  }

  /** Throw a new burst from `anchor` [lon, lat]; replaces any burst still running. */
  fire(anchor: readonly [number, number], color: string): void {
    this.anchor = anchor;
    this.color = color;
    for (let i = 0; i < BURST_SIZE; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = SPEED[0] + (SPEED[1] - SPEED[0]) * this.rng() ** 1.5;
      this.x[i] = 0;
      this.y[i] = 0;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.age[i] = 0;
      this.life[i] = LIFE[0] + (LIFE[1] - LIFE[0]) * this.rng();
      this.size[i] = 1.2 + 2.4 * this.rng() ** 2;
    }
    this.live = BURST_SIZE;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    const k = DRAG ** dt;
    let live = 0;
    for (let i = 0; i < BURST_SIZE; i++) {
      if ((this.age[i] as number) >= (this.life[i] as number)) continue;
      this.age[i] = (this.age[i] as number) + dt;
      this.vx[i] = (this.vx[i] as number) * k;
      this.vy[i] = (this.vy[i] as number) * k + 30 * dt; // a little fall
      this.x[i] = (this.x[i] as number) + (this.vx[i] as number) * dt;
      this.y[i] = (this.y[i] as number) + (this.vy[i] as number) * dt;
      if ((this.age[i] as number) < (this.life[i] as number)) live++;
    }
    this.live = live;
  }

  /** Alpha of spark i: bright at once, then fading out over its life. */
  alpha(i: number): number {
    const t = (this.age[i] as number) / (this.life[i] as number);
    return t >= 1 ? 0 : (1 - t) ** 1.5;
  }

  /** Draw at the projected anchor (device px); `k` is the device pixel ratio. */
  draw(ctx: CanvasRenderingContext2D, at: readonly [number, number], k: number): void {
    if (this.live === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = this.color;
    for (let i = 0; i < BURST_SIZE; i++) {
      const a = this.alpha(i);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(
        at[0] + (this.x[i] as number) * k,
        at[1] + (this.y[i] as number) * k,
        (this.size[i] as number) * k,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  /** Tests: where spark i is, CSS px from the anchor. */
  offset(i: number): [number, number] {
    return [this.x[i] as number, this.y[i] as number];
  }
}

/** Your country's flash on landing (V6): up in 0.12 s, then fading; 0 from FLASH_END on. */
export const FLASH_END = 1.6;
export function flashAmount(t: number): number {
  if (t < 0 || t >= FLASH_END) return 0;
  if (t < 0.12) return t / 0.12;
  return Math.exp(-(t - 0.12) / 0.45);
}
