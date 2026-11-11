import { MOOD_COUNT } from "@world-emotion/shared";

const DEG = Math.PI / 180;

/** Small, fast, seedable PRNG so benchmark runs are identical (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpawnPoint {
  /** Points on the region's land, flat [lon, lat, lon, lat, …] (engine/land.ts). At least one. */
  readonly points: Float32Array;
  readonly mood: number;
  /** Relative chance of spawning here (how strongly the region feels its mood). */
  readonly weight: number;
}

/**
 * Soft round particles are drawn this much larger than their nominal size: the glow's edge fades
 * out, so the visible core stays about as big as the old square (bridge U2).
 */
const SOFT_SCALE = 2;
/** All weather is a fifth fainter than in Phase 4 (bridge U2: it read as noise on the globe). */
const FAINTER = 0.8;
const SPRITE_PX = 32;

/**
 * Mood weather (README §8.2.3), one behaviour per mood. `soft`: a round glow (fireflies, mist,
 * sparkle, embers); the rest stay hard on purpose (static is square pixels, rain is streaks). Velocities are screen-space (CSS px/s,
 * negative y = up), anchored to a point on the sphere so weather rises off the land it belongs to.
 */
const WEATHER = [
  /* happy: rising fireflies */ {
    soft: true,
    vx: 6,
    vyMin: -16,
    vyMax: -8,
    ttlMin: 2,
    ttlMax: 4,
    size: 2.6,
    alpha: 0.95,
    streak: false,
    jitter: 0,
    flicker: 0.3,
  },
  /* calm: slow drifting mist */ {
    soft: true,
    vx: 4,
    vyMin: -2,
    vyMax: 2,
    ttlMin: 4,
    ttlMax: 7,
    size: 10,
    alpha: 0.13,
    streak: false,
    jitter: 0,
    flicker: 0,
  },
  /* excited: sparkle bursts */ {
    soft: true,
    vx: 0,
    vyMin: 0,
    vyMax: 0,
    ttlMin: 0.6,
    ttlMax: 1.2,
    size: 2.2,
    alpha: 1,
    streak: false,
    jitter: 0,
    flicker: 0.6,
  },
  /* stressed: jittery static */ {
    soft: false,
    vx: 0,
    vyMin: 0,
    vyMax: 0,
    ttlMin: 0.3,
    ttlMax: 0.8,
    size: 1.8,
    alpha: 0.9,
    streak: false,
    jitter: 2.5,
    flicker: 0.8,
  },
  /* sad: falling rain */ {
    soft: false,
    vx: -2,
    vyMin: 20,
    vyMax: 34,
    ttlMin: 0.8,
    ttlMax: 1.6,
    size: 1.2,
    alpha: 0.75,
    streak: true,
    jitter: 0,
    flicker: 0,
  },
  /* angry: rising embers */ {
    soft: true,
    vx: 8,
    vyMin: -30,
    vyMax: -18,
    ttlMin: 1,
    ttlMax: 2.4,
    size: 2.4,
    alpha: 1,
    streak: false,
    jitter: 0,
    flicker: 0.7,
  },
] as const;
if (WEATHER.length !== MOOD_COUNT) throw new Error("weather must cover every mood");

/**
 * Layer 3 particles (README §8.1): struct-of-arrays in typed arrays, fixed capacity, no
 * allocation in `update` or `draw`. One path + one fill per mood per frame, whatever the count.
 */
export class ParticleField {
  private readonly lon: Float32Array;
  private readonly lat: Float32Array;
  private readonly ox: Float32Array;
  private readonly oy: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly age: Float32Array;
  private readonly ttl: Float32Array;
  private readonly mood: Uint8Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly vis: Uint8Array;
  private spawns: readonly SpawnPoint[] = [];
  /** One pre-rendered glow per mood colour, made on the first draw (never in the frame loop after). */
  private sprites: (HTMLCanvasElement | null)[] = [];
  private spriteColors = "";
  private cumulative = new Float64Array(0);

  constructor(
    readonly count: number,
    spawns: readonly SpawnPoint[],
    private readonly random: () => number,
  ) {
    this.lon = new Float32Array(count);
    this.lat = new Float32Array(count);
    this.ox = new Float32Array(count);
    this.oy = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.age = new Float32Array(count);
    this.ttl = new Float32Array(count);
    this.mood = new Uint8Array(count);
    this.sx = new Float32Array(count);
    this.sy = new Float32Array(count);
    this.vis = new Uint8Array(count);
    this.setSpawns(spawns);
    for (let i = 0; i < count; i++) {
      this.respawn(i);
      this.age[i] = this.random() * (this.ttl[i] ?? 1); // desynchronise lifecycles
    }
  }

  /** New weather map (e.g. a new snapshot). Existing particles finish their lives first. */
  setSpawns(spawns: readonly SpawnPoint[]): void {
    this.spawns = spawns;
    this.cumulative = new Float64Array(spawns.length);
    let sum = 0;
    for (let i = 0; i < spawns.length; i++) {
      sum += Math.max(0, spawns[i]?.weight ?? 0);
      this.cumulative[i] = sum;
    }
  }

  private pick(): SpawnPoint | undefined {
    const total = this.cumulative[this.cumulative.length - 1] ?? 0;
    if (total <= 0) return undefined;
    const x = this.random() * total;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.cumulative[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return this.spawns[lo];
  }

  private respawn(i: number): void {
    const s = this.pick();
    if (s === undefined) {
      this.ttl[i] = 1;
      this.age[i] = 0;
      this.mood[i] = 255; // inactive
      return;
    }
    const w = WEATHER[s.mood] ?? WEATHER[0];
    // A point on the land itself: no jitter, which is what pushed weather into the sea.
    const n = s.points.length >> 1;
    const k = n > 1 ? Math.min(n - 1, Math.floor(this.random() * n)) : 0;
    this.lon[i] = s.points[k * 2] ?? 0;
    this.lat[i] = s.points[k * 2 + 1] ?? 0;
    this.ox[i] = 0;
    this.oy[i] = 0;
    if (s.mood === 2) {
      // excited: radial burst
      const a = this.random() * Math.PI * 2;
      const v = 20 + this.random() * 25;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
    } else {
      this.vx[i] = (this.random() - 0.5) * 2 * w.vx;
      this.vy[i] = w.vyMin + this.random() * (w.vyMax - w.vyMin);
    }
    if (s.mood === 4) this.oy[i] = -14 - this.random() * 10; // rain starts above the land
    this.age[i] = 0;
    this.ttl[i] = w.ttlMin + this.random() * (w.ttlMax - w.ttlMin);
    this.mood[i] = s.mood;
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] as number) + dt;
      if (age >= (this.ttl[i] as number)) {
        this.respawn(i);
        continue;
      }
      this.age[i] = age;
      this.ox[i] = (this.ox[i] as number) + (this.vx[i] as number) * dt;
      this.oy[i] = (this.oy[i] as number) + (this.vy[i] as number) * dt;
    }
  }

  /** `rotate` is d3's [λ, φ]; centre/radius in canvas px; `px` = canvas px per CSS px. */
  draw(
    ctx: CanvasRenderingContext2D,
    rotate: readonly [number, number],
    cx: number,
    cy: number,
    r: number,
    colors: readonly string[],
    px: number,
  ): void {
    const lam0 = -rotate[0] * DEG;
    const phi0 = -rotate[1] * DEG;
    const sinP0 = Math.sin(phi0);
    const cosP0 = Math.cos(phi0);
    for (let i = 0; i < this.count; i++) {
      if (this.mood[i] === 255) {
        this.vis[i] = 0;
        continue;
      }
      const lam = (this.lon[i] as number) * DEG;
      const phi = (this.lat[i] as number) * DEG;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const dl = lam - lam0;
      const cosDl = Math.cos(dl);
      const depth = sinP0 * sinP + cosP0 * cosP * cosDl;
      this.vis[i] = depth > 0.05 ? 1 : 0;
      if (depth <= 0.05) continue;
      this.sx[i] = cx + r * cosP * Math.sin(dl) + (this.ox[i] as number) * px;
      this.sy[i] = cy - r * (cosP0 * sinP - sinP0 * cosP * cosDl) + (this.oy[i] as number) * px;
    }
    this.ensureSprites(colors);
    for (let m = 0; m < MOOD_COUNT; m++) {
      const w = WEATHER[m] ?? WEATHER[0];
      const sprite = w.soft ? this.sprites[m] : null;
      ctx.globalAlpha = w.alpha * FAINTER;
      if (!sprite) ctx.beginPath();
      for (let i = 0; i < this.count; i++) {
        if (this.vis[i] === 0 || this.mood[i] !== m) continue;
        const life = (this.age[i] as number) / (this.ttl[i] as number);
        let s = w.size * px * (1 - Math.abs(life * 2 - 1) * 0.8); // grow, then fade out
        if (w.flicker > 0 && this.random() < w.flicker * 0.15) s *= 0.3;
        let x = this.sx[i] as number;
        let y = this.sy[i] as number;
        if (w.jitter > 0) {
          x += (this.random() - 0.5) * 2 * w.jitter * px;
          y += (this.random() - 0.5) * 2 * w.jitter * px;
        }
        if (sprite) {
          const d = s * SOFT_SCALE;
          ctx.drawImage(sprite, x - d / 2, y - d / 2, d, d);
        } else if (w.streak) ctx.rect(x, y, Math.max(1, s), s * 6);
        else ctx.rect(x - s / 2, y - s / 2, s, s);
      }
      if (!sprite) {
        ctx.fillStyle = colors[m] ?? "#fff";
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A radial glow per soft mood, in its colour; rebuilt only if the palette changes. */
  private ensureSprites(colors: readonly string[]): void {
    const key = colors.join(",");
    if (key === this.spriteColors) return;
    this.spriteColors = key;
    this.sprites = WEATHER.map((w, m) => {
      if (!w.soft || typeof document === "undefined") return null;
      const c = document.createElement("canvas");
      c.width = SPRITE_PX;
      c.height = SPRITE_PX;
      const g = c.getContext("2d");
      if (!g) return null;
      const h = SPRITE_PX / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      const col = colors[m] ?? "#fff";
      grad.addColorStop(0, col);
      grad.addColorStop(0.35, col);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = grad;
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(h, h, h, 0, Math.PI * 2);
      g.fill();
      // Fade the colour itself to transparent at the edge (the stop above is black at 0 alpha,
      // which would darken the rim): redraw the falloff as alpha only.
      g.globalCompositeOperation = "destination-in";
      const mask = g.createRadialGradient(h, h, 0, h, h, h);
      mask.addColorStop(0, "rgba(0, 0, 0, 1)");
      mask.addColorStop(0.35, "rgba(0, 0, 0, 0.85)");
      mask.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = mask;
      g.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
      return c;
    });
  }

  /** Test access: where each live particle is anchored on the sphere, [lon, lat, mood]. */
  anchors(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let i = 0; i < this.count; i++)
      if (this.mood[i] !== 255)
        out.push([this.lon[i] as number, this.lat[i] as number, this.mood[i] as number]);
    return out;
  }
}
