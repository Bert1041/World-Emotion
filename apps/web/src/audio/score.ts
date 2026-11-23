import type { MoodId } from "@world-emotion/shared";
import {
  BARS_PER_CHORD,
  chordAt,
  type MoodMusic,
  midiToHz,
  musicFor,
  noteAt,
  STEPS_PER_BAR,
} from "./theory";

/**
 * The generative score (Phase 6.5, S1), Web Audio only: an organ-like figure, a slow pad and a low
 * drone through a low-pass filter and a long reverb. Lazy chunk: loaded on the first press of the
 * sound button, never part of the first download. All sound runs on the browser's audio thread;
 * this code only schedules notes a little ahead (every 120 ms, 0.6 s of look-ahead).
 */
const LOOKAHEAD_S = 0.6;
const TICK_MS = 120;
const MASTER = 0.8;

/** Organ timbre: a fundamental and a few soft harmonics (drawbar-like). */
const ORGAN = [0, 1, 0.5, 0.28, 0.16, 0.09, 0.05, 0.03];

export class Score {
  private readonly master: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly organ: PeriodicWave;
  private readonly droneOsc: OscillatorNode[] = [];
  private readonly droneGain: GainNode;
  private music: MoodMusic;
  private pending: MoodMusic | null = null;
  private n = 0;
  private nextAt = 0;
  private timer = 0;
  private padChord = -1;

  constructor(
    private readonly ctx: BaseAudioContext,
    mood: MoodId | null,
    private readonly rng: () => number = Math.random,
  ) {
    this.music = musicFor(mood);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.music.cutoff;
    this.filter.Q.value = 0.4;
    const dry = ctx.createGain();
    dry.gain.value = 0.55;
    const wet = ctx.createGain();
    wet.gain.value = 0.75;
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 4.5, 2.6, rng);
    this.filter.connect(dry).connect(this.master);
    this.filter.connect(reverb).connect(wet).connect(this.master);

    const real = new Float32Array(ORGAN.length);
    const imag = new Float32Array(ORGAN);
    this.organ = ctx.createPeriodicWave(real, imag);

    // The drone: the key's root two octaves down and its fifth, with a slow swell on the cutoff.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = this.music.drone;
    this.droneGain.connect(this.filter);
    for (const [semi, level] of [
      [-24, 1],
      [-17, 0.5],
    ] as const) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.organ);
      o.frequency.value = midiToHz(this.music.root + semi);
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(this.droneGain);
      o.start();
      this.droneOsc.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const depth = ctx.createGain();
    depth.gain.value = 350;
    lfo.connect(depth).connect(this.filter.frequency);
    lfo.start();
  }

  /** Fade in over a few seconds and start scheduling. */
  start(): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(MASTER, t + 3);
    this.nextAt = Math.max(this.nextAt, t + 0.1);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** Fade out; resolves when silent (the caller may then suspend the context). */
  stop(): Promise<void> {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.8);
    clearInterval(this.timer);
    return new Promise((ok) => setTimeout(ok, 850));
  }

  /** The world's mood changed: the new key starts at the next chord; drone and tone glide there. */
  setMood(mood: MoodId | null): void {
    const next = musicFor(mood);
    if (next === this.music) return;
    this.pending = next;
    const t = this.ctx.currentTime;
    for (const [i, o] of this.droneOsc.entries())
      o.frequency.setTargetAtTime(midiToHz(next.root + (i === 0 ? -24 : -17)), t, 2.5);
    this.droneGain.gain.setTargetAtTime(next.drone, t, 3);
    this.filter.frequency.setTargetAtTime(next.cutoff, t, 3);
  }

  /** The check-in chime: a soft bell two octaves above the current chord's root. */
  chime(): void {
    const t = this.ctx.currentTime + 0.02;
    const f = midiToHz((chordAt(this.music, this.n)[0] as number) + 24);
    for (const [ratio, level, decay] of [
      [1, 0.22, 2.8],
      [2.76, 0.08, 1.6],
      [5.4, 0.04, 0.9],
    ] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.filter);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  private schedule(): void {
    this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD_S);
  }

  /** Schedule every note up to `horizon` (s). Also lets a test render the score offline. */
  scheduleUntil(horizon: number): void {
    while (this.nextAt < horizon) {
      // A pending key change takes effect at a chord boundary, so no chord is cut in half.
      if (this.pending && this.n % (STEPS_PER_BAR * BARS_PER_CHORD) === 0) {
        this.music = this.pending;
        this.pending = null;
        this.n = 0;
        this.padChord = -1;
      }
      const chordIndex = Math.floor(this.n / (STEPS_PER_BAR * BARS_PER_CHORD));
      if (chordIndex !== this.padChord) {
        this.padChord = chordIndex;
        this.pad(this.nextAt);
      }
      const note = noteAt(this.music, this.n, this.rng);
      if (note) this.voice(midiToHz(note.midi), this.nextAt, note.velocity);
      this.nextAt += this.music.step;
      this.n++;
    }
  }

  /** One figure note: a soft attack, held a little past its step, a long release into the reverb. */
  private voice(hz: number, at: number, velocity: number): void {
    const o = this.ctx.createOscillator();
    o.setPeriodicWave(this.organ);
    o.frequency.value = hz;
    const g = this.ctx.createGain();
    const peak = 0.11 * velocity;
    const hold = this.music.step * 1.6;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.05);
    g.gain.setTargetAtTime(peak * 0.6, at + 0.05, 0.2);
    g.gain.setTargetAtTime(0, at + hold, 0.5);
    o.connect(g).connect(this.filter);
    o.start(at);
    o.stop(at + hold + 3);
  }

  /** The pad: the chord's three lower tones an octave down, swelling in over two seconds. */
  private pad(at: number): void {
    const tones = chordAt(this.music, this.n);
    const length = this.music.step * STEPS_PER_BAR * BARS_PER_CHORD;
    for (const midi of tones.slice(0, 3)) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = midiToHz(midi - 12);
      o.detune.value = (this.rng() - 0.5) * 8; // a little chorus
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 2);
      g.gain.setTargetAtTime(0, at + length, 1.2);
      o.connect(g).connect(this.filter);
      o.start(at);
      o.stop(at + length + 6);
    }
  }
}

/** A reverb impulse made in code: stereo noise decaying over `seconds` (no file to download). */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, rng: () => number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (rng() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}
