import type { MoodId } from "@world-emotion/shared";
import type { Score } from "./score";

/**
 * The sound switch (Phase 6.5, S3). Off by default; the choice is remembered on the device.
 * Browsers only let audio start from a gesture, so a remembered "on" waits for the first touch or
 * key. The score itself is a lazy chunk, loaded the first time sound is turned on. Fades out when
 * the tab is hidden and back in on return.
 */
export const SOUND_KEY = "we.sound";

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

export class Sound {
  on: boolean;
  private ctx: AudioContext | null = null;
  private score: Score | null = null;
  private loading: Promise<Score | null> | null = null;
  private mood: MoodId | null = null;

  constructor(private readonly changed: (on: boolean) => void) {
    this.on = read() === "1";
    if (this.on) {
      // Remembered "on": start with the first gesture anywhere (autoplay rules).
      const go = () => {
        removeEventListener("pointerdown", go, true);
        removeEventListener("keydown", go, true);
        if (this.on) void this.play();
      };
      addEventListener("pointerdown", go, true);
      addEventListener("keydown", go, true);
    }
    document.addEventListener("visibilitychange", () => {
      if (!this.on || this.score === null) return;
      if (document.hidden) void this.score.stop().then(() => this.suspendIfSilent());
      else void this.ctx?.resume().then(() => this.score?.start());
    });
  }

  /** The button: must be called from the click itself (a user gesture). */
  toggle(): void {
    this.on = !this.on;
    write(this.on ? "1" : "0");
    this.changed(this.on);
    if (this.on) void this.play();
    else void this.score?.stop().then(() => this.suspendIfSilent());
  }

  /**
   * After a fade-out: suspend, unless the music was turned back on (or the tab came back) during
   * the fade. QA 2026-11-23: on-off-on in quick succession left the button on and the music silent.
   */
  private suspendIfSilent(): void {
    if (!this.on || document.hidden) void this.ctx?.suspend();
  }

  setMood(mood: MoodId | null): void {
    this.mood = mood;
    this.score?.setMood(mood);
  }

  chime(): void {
    if (this.on) this.score?.chime();
  }

  private async play(): Promise<void> {
    if (this.ctx === null) {
      // iOS: play even with the ringer switch on silent (Safari 17+), as media does.
      const nav = navigator as AudioSessionNavigator;
      if (nav.audioSession) nav.audioSession.type = "playback";
      this.ctx = new AudioContext();
    }
    void this.ctx.resume(); // inside the gesture: allowed to start
    this.loading ??= import("./score")
      .then((m) => new m.Score(this.ctx as AudioContext, this.mood))
      .catch(() => null);
    this.score = await this.loading;
    if (this.on) this.score?.start();
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(SOUND_KEY);
  } catch {
    return null;
  }
}
function write(v: string): void {
  try {
    localStorage.setItem(SOUND_KEY, v);
  } catch {
    // blocked: the choice lasts this visit only
  }
}
