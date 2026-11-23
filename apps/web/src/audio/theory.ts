import type { MoodId } from "@world-emotion/shared";

/**
 * The score's music theory (Phase 6.5, S1), pure so it can be tested without sound. Original
 * material: a slow organ figure over a drone, in a key and pace chosen by the world's mood. No
 * melody, recording or sample from any film.
 */

/** Scales as semitone steps from the root. */
export const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
} as const;

export interface MoodMusic {
  /** MIDI note of the key's root (the figure's register). */
  readonly root: number;
  readonly scale: readonly number[];
  /** Chord roots as scale degrees (0-based), two bars each. */
  readonly progression: readonly number[];
  /** Seconds per figure note. */
  readonly step: number;
  /** Low-pass cutoff, Hz: darker moods are duller. */
  readonly cutoff: number;
  /** Drone level, 0–1. */
  readonly drone: number;
}

/** Indexed by MoodId: happy, calm, excited, stressed, sad, angry. */
export const MOOD_MUSIC: readonly MoodMusic[] = [
  {
    root: 53,
    scale: SCALES.ionian,
    progression: [0, 4, 5, 3],
    step: 0.42,
    cutoff: 2600,
    drone: 0.1,
  },
  {
    root: 50,
    scale: SCALES.lydian,
    progression: [0, 4, 1, 4],
    step: 0.6,
    cutoff: 1900,
    drone: 0.12,
  },
  {
    root: 52,
    scale: SCALES.lydian,
    progression: [0, 1, 5, 4],
    step: 0.28,
    cutoff: 3200,
    drone: 0.08,
  },
  {
    root: 49,
    scale: SCALES.phrygian,
    progression: [0, 1, 0, 6],
    step: 0.31,
    cutoff: 1500,
    drone: 0.16,
  },
  {
    root: 45,
    scale: SCALES.aeolian,
    progression: [0, 5, 2, 6],
    step: 0.72,
    cutoff: 1300,
    drone: 0.14,
  },
  {
    root: 48,
    scale: SCALES.phrygian,
    progression: [0, 1, 6, 1],
    step: 0.36,
    cutoff: 1100,
    drone: 0.22,
  },
];

/** A quiet world (below the privacy floor) plays calm, softer. */
export function musicFor(mood: MoodId | null): MoodMusic {
  return MOOD_MUSIC[mood ?? 1] as MoodMusic;
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** The MIDI note of scale degree `d` (any integer; wraps into octaves). */
export function degree(music: MoodMusic, d: number): number {
  const n = music.scale.length;
  const oct = Math.floor(d / n);
  const i = ((d % n) + n) % n;
  return music.root + 12 * oct + (music.scale[i] as number);
}

/** A chord on scale degree `d`: root, third, fifth and the octave above, as MIDI notes. */
export function chord(music: MoodMusic, d: number): [number, number, number, number] {
  return [degree(music, d), degree(music, d + 2), degree(music, d + 4), degree(music, d + 7)];
}

/** The figure: which chord tone each of the bar's eight steps plays. */
export const FIGURE = [0, 2, 1, 3, 0, 2, 1, 2] as const;
export const STEPS_PER_BAR = FIGURE.length;
export const BARS_PER_CHORD = 2;

export interface Note {
  readonly midi: number;
  /** 0–1. */
  readonly velocity: number;
}

/**
 * The note at figure step `n` (counting from the start of the piece), or null for a rest. `rng`
 * adds the variation that keeps it from looping the same way twice: an occasional rest, a lift of
 * an octave at the end of a bar, uneven velocities.
 */
export function noteAt(music: MoodMusic, n: number, rng: () => number): Note | null {
  const step = n % STEPS_PER_BAR;
  const tones = chordAt(music, n);
  if (step !== 0 && rng() < 0.1) return null; // the downbeat always sounds
  let midi = tones[FIGURE[step] as number] as number;
  if (step === STEPS_PER_BAR - 1 && rng() < 0.15) midi += 12;
  const accent = step === 0 ? 1 : step === 4 ? 0.85 : 0.7;
  return { midi, velocity: accent * (0.8 + 0.2 * rng()) };
}

/** The chord under figure step `n` (for the pad, the drone and the check-in chime). */
export function chordAt(music: MoodMusic, n: number): [number, number, number, number] {
  const bar = Math.floor(n / STEPS_PER_BAR);
  const d = music.progression[
    Math.floor(bar / BARS_PER_CHORD) % music.progression.length
  ] as number;
  return chord(music, d);
}
