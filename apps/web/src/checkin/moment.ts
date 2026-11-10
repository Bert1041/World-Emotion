import { FixedStep, SPRING, Spring } from "@world-emotion/motion";
import type { MoodId } from "@world-emotion/shared";
import { type GeoPath, type GeoProjection, geoDistance } from "d3-geo";
import type { SnapshotSource } from "../data/snapshot-source";
import type { Camera } from "../engine/camera";
import { guessCountry } from "../engine/country-guess";
import { MOOD_COLORS } from "../engine/palette";
import { Ripples, ringOutline } from "../engine/ripple";
import { view } from "../ui/view.svelte";
import { PIN_KEY, type Pin, parseSavedPin } from "./saved-pin";

/**
 * The check-in moment (README §8.2.5) and your pin: where you are, the flight of your face, the
 * ripple where it lands, the count ticking. Writes to `view`; draws the pin and ripples on the FX
 * layer. The pure part (the saved-pin parse) lives in saved-pin.ts, tested on its own.
 */

export interface MomentDeps {
  readonly camera: Camera;
  readonly projection: GeoProjection;
  readonly fx: CanvasRenderingContext2D;
  readonly fxPath: GeoPath;
  readonly reducedMotion: boolean;
  readonly source: Pick<SnapshotSource, "checkIn">;
  readonly known: ReadonlyMap<string, unknown>;
  /** The theme accent, for the pin (read once per frame by the caller, not per draw). */
  accent(): string;
  /** Where your face lands: the globe's centre once it has turned to you (CSS px). */
  landingPoint(): { x: number; y: number };
  dpr(): number;
  /** Active check-ins in the world snapshot, so a landing never counts below it. */
  worldN(): number;
  invalidate(): void;
  touched(): void;
}

export class CheckInMoment {
  pin: Pin | null = null;
  readonly ripples = new Ripples();
  /** Pin points per country (inside the country, on its largest landmass), set at init(). */
  private pinPoints = new Map<string, [number, number]>();
  /** The pin drop: a bouncy spring on its height above the ground (CSS px), on the fixed step. */
  private readonly pinDrop = new Spring(0, SPRING.bouncy);
  private readonly pinStep = new FixedStep();
  private flightId = 0;
  /** Where your face lands and the ripple starts: your country's centre. */
  private landing: { center: [number, number]; mood: MoodId; first: boolean } | null = null;

  constructor(private readonly d: MomentDeps) {}

  /** Restore the saved pin or guess the country (M2); called once pin points are known. */
  init(pinPoints: Map<string, [number, number]>, languages: readonly string[]): void {
    this.pinPoints = pinPoints;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(PIN_KEY);
    } catch {
      // storage blocked
    }
    this.pin = parseSavedPin(saved, this.d.known);
    if (this.pin === null) {
      const code = guessCountry(languages, this.d.known);
      const at = code === null ? undefined : pinPoints.get(code);
      if (code !== null && at !== undefined) this.pin = { code, lonLat: at };
    }
    view.checkin.country = this.pin?.code ?? null;
  }

  /** Put your pin down (a tap on the globe, or a search result) and drop it in with a bounce. */
  placePin(code: string, lonLat: [number, number]): void {
    if (!this.d.known.has(code)) return;
    this.pin = { code, lonLat };
    view.checkin.country = code;
    view.checkin.picking = false;
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify({ code, lon: lonLat[0], lat: lonLat[1] }));
    } catch {
      // a per-device convenience only
    }
    this.pinDrop.value = this.d.reducedMotion ? 0 : 46;
    this.pinDrop.velocity = 0;
    this.pinDrop.target = 0;
    this.d.invalidate();
  }

  /** Chosen from the search: pin the country's pin point and show where it went. */
  setCountry(code: string): void {
    const at = this.pinPoints.get(code);
    if (at === undefined) return;
    this.placePin(code, at);
    this.d.camera.glideTo({ center: at, zoom: 1, offset: [0, 0] });
  }

  startPick(): void {
    view.checkin.picking = true;
    this.d.touched();
    // "The globe spins to you": bring your current pin (if any) to the front to start from.
    if (this.pin !== null)
      this.d.camera.glideTo({ center: this.pin.lonLat, zoom: 1, offset: [0, 0] });
    this.d.invalidate();
  }

  cancelPick(): void {
    view.checkin.picking = false;
  }

  checkIn(mood: MoodId, from: { x: number; y: number }): void {
    if (this.pin === null) return;
    const { code, lonLat } = this.pin;
    const first = view.checkin.mine === null;
    this.d.source.checkIn(code, mood); // counted from the next aggregation run, like the real pipeline
    view.checkin.mine = mood;
    this.d.touched();
    // Turn your pin to the front; the face lands where it will be (the globe's centre).
    this.d.camera.glideTo({ center: lonLat, zoom: 1, offset: [0, 0] });
    this.d.invalidate();
    this.landing = { center: lonLat, mood, first };
    if (this.d.reducedMotion) {
      this.landed(-1); // no pop, flight or ripple: the chip cross-fades in and the count updates
      return;
    }
    this.flightId++;
    view.flight = { id: this.flightId, mood, from, to: this.d.landingPoint() };
  }

  landed(id: number): void {
    if (view.flight !== null && view.flight.id !== id) return; // a newer flight replaced it
    view.flight = null;
    const l = this.landing;
    this.landing = null;
    if (l === null) return;
    // A first check-in adds one; a change of mood replaces your vote. Never below the snapshot.
    view.worldCount = Math.max(view.worldCount + (l.first ? 1 : 0), this.d.worldN());
    if (this.d.reducedMotion) return;
    this.ripples.add(l.center, MOOD_COLORS[l.mood] ?? "#fff");
    // Android; iOS has no vibration API (README §8.6). 30 ms: 12 ms could not be felt on a Pixel 6 Pro.
    navigator.vibrate?.(30);
  }

  /** Ripples and the pin, on the FX layer (the caller has cleared it and drawn the halo). */
  draw(dt: number): void {
    const { fx, fxPath } = this.d;
    const dpr = this.d.dpr();
    this.ripples.update(dt);
    if (this.ripples.active) {
      // Rings are small circles on the sphere, so they bend over the horizon (clipped at 90°).
      for (const ring of this.ripples.rings()) {
        fx.beginPath();
        fxPath(ringOutline(ring.center, ring.radius));
        fx.globalAlpha = ring.alpha;
        fx.strokeStyle = ring.color;
        fx.lineWidth = (3 - ring.index * 0.8) * dpr;
        fx.stroke();
      }
      fx.globalAlpha = 1;
    }
    this.drawPin(dt, dpr);
  }

  /** "You are here": hidden when it is round the back of the globe. */
  private drawPin(dt: number, k: number): void {
    if (this.pin === null) return;
    const { fx, camera, projection } = this.d;
    this.pinStep.advance(dt, (h) => this.pinDrop.step(h));
    if (Math.abs(this.pinDrop.value) < 0.05 && Math.abs(this.pinDrop.velocity) < 0.05)
      this.pinDrop.snap();
    if (geoDistance(this.pin.lonLat, camera.rendered.center) > Math.PI / 2 - 0.05) return;
    const p = projection(this.pin.lonLat);
    if (!p) return;
    const [x, y0] = p;
    const y = y0 - this.pinDrop.value * k;
    fx.fillStyle = "rgba(0, 0, 0, 0.35)"; // shadow on the ground, under the pin
    fx.beginPath();
    fx.ellipse(x, y0, 4 * k, 1.6 * k, 0, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = this.d.accent();
    fx.strokeStyle = "#0a0c10";
    fx.lineWidth = 1.2 * k;
    fx.beginPath();
    fx.moveTo(x, y);
    fx.bezierCurveTo(x - 7 * k, y - 9 * k, x - 7 * k, y - 18 * k, x, y - 18 * k);
    fx.bezierCurveTo(x + 7 * k, y - 18 * k, x + 7 * k, y - 9 * k, x, y);
    fx.fill();
    fx.stroke();
    fx.fillStyle = "#0a0c10";
    fx.beginPath();
    fx.arc(x, y - 12.5 * k, 2.2 * k, 0, Math.PI * 2);
    fx.fill();
  }
}
