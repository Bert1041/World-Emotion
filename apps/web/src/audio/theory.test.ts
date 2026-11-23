import { describe, expect, it } from "vitest";
import { rng } from "../engine/particles";
import {
  chord,
  chordAt,
  degree,
  MOOD_MUSIC,
  midiToHz,
  musicFor,
  noteAt,
  STEPS_PER_BAR,
} from "./theory";

const inKey = (music: (typeof MOOD_MUSIC)[number], midi: number) =>
  music.scale.includes((((midi - music.root) % 12) + 12) % 12);

describe("score theory", () => {
  it("A4 is 440 Hz and an octave doubles", () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });

  it("degrees wrap into octaves, both ways", () => {
    const m = MOOD_MUSIC[4]; // sad, A aeolian
    if (!m) throw new Error("no sad");
    expect(degree(m, 0)).toBe(m.root);
    expect(degree(m, 7)).toBe(m.root + 12);
    expect(degree(m, -1)).toBe(m.root - 2); // G below A
  });

  it("a chord is root, third, fifth and octave of its degree", () => {
    const m = musicFor(0);
    const [r, , , o] = chord(m, 3);
    expect(o - r).toBe(12);
  });

  it("every note of every mood stays in its key, for minutes of music", () => {
    for (const m of MOOD_MUSIC) {
      const r = rng(3);
      for (let n = 0; n < 2000; n++) {
        const note = noteAt(m, n, r);
        if (note) expect(inKey(m, note.midi), `${m.root} step ${n}`).toBe(true);
        for (const t of chordAt(m, n)) expect(inKey(m, t)).toBe(true);
      }
    }
  });

  it("the downbeat always sounds; other steps sometimes rest; velocities stay in 0–1", () => {
    const m = musicFor(1);
    const r = rng(9);
    let rests = 0;
    for (let n = 0; n < 4000; n++) {
      const note = noteAt(m, n, r);
      if (n % STEPS_PER_BAR === 0) expect(note).not.toBeNull();
      if (note === null) rests++;
      else expect(note.velocity).toBeGreaterThan(0), expect(note.velocity).toBeLessThanOrEqual(1);
    }
    expect(rests).toBeGreaterThan(0);
    expect(rests).toBeLessThan(4000 * 0.15);
  });

  it("every note of the figure is a tone of the chord under it (or that tone an octave up)", () => {
    for (const m of MOOD_MUSIC) {
      const r = rng(5);
      for (let n = 0; n < 500; n++) {
        const note = noteAt(m, n, r);
        if (note === null) continue;
        const tones = chordAt(m, n);
        expect(tones.includes(note.midi) || tones.includes(note.midi - 12), `${m.root} @${n}`).toBe(
          true,
        );
      }
    }
  });

  it("the chord changes every two bars, through the mood's progression", () => {
    const m = musicFor(4);
    const bars = (b: number) => chordAt(m, b * STEPS_PER_BAR)[0];
    expect(bars(0)).toBe(bars(1));
    expect(bars(2)).toBe(degree(m, m.progression[1] as number));
    expect(bars(2 * m.progression.length)).toBe(bars(0)); // loops round
  });

  it("a quiet world plays calm; each mood has its own key and pace", () => {
    expect(musicFor(null)).toBe(musicFor(1));
    const keys = new Set(MOOD_MUSIC.map((m) => `${m.root}/${m.step}`));
    expect(keys.size).toBe(6);
    // Sad is the slowest, excited the quickest.
    const steps = MOOD_MUSIC.map((m) => m.step);
    expect(Math.max(...steps)).toBe(musicFor(4).step);
    expect(Math.min(...steps)).toBe(musicFor(2).step);
  });
});
