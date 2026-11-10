import type { Camera } from "./camera";

/**
 * Pointer and wheel input on the globe: drag + fling, tap, two-finger pinch and ctrl+wheel stretch
 * between the world and a continent (README §8.2.2). Owns the gesture state; what a tap or a
 * released stretch *means* (enter, leave, place a pin) is the caller's, through `deps`.
 */

export interface InputDeps {
  readonly camera: Camera;
  /** Degrees of rotation per CSS px of drag at the globe's centre, now. */
  degreesPerPx(): number;
  /** A tap (pointer down and up within TAP_SLOP_PX), in CSS px. */
  onTap(at: { x: number; y: number }): void;
  /** A zoom gesture let go with this stretch (log scale ratio), centred at `at`. */
  onStretchRelease(stretch: number, at: { x: number; y: number }): void;
  /** Any input happened (idle rotation waits a while after this). */
  touched(): void;
  /** Something needs redrawing. */
  invalidate(): void;
}

export interface InputState {
  readonly dragging: boolean;
}

export interface Move {
  readonly t: number;
  readonly dLon: number;
  readonly dLat: number;
}

/**
 * Release velocity is averaged over a window, not the last pair of events. One pair is noisy
 * (timestamp jitter), and where moves arrive in a burst (Chrome aligns them to frames, but not
 * every browser or input path does) one tiny gap would read a normal swipe as thousands of degrees
 * per second. Capped as a last guard.
 */
export const VELOCITY_WINDOW_MS = 100;
export const MAX_FLING_DEG_S = 720;
export const TAP_SLOP_PX = 6;
/**
 * One wheel gesture lasts until the wheel is quiet for this long: long enough that a slow,
 * deliberate scroll (a notch every ~200 ms) still adds up, short enough that a single notch springs
 * back promptly.
 */
export const WHEEL_GESTURE_MS = 250;

/** Mean velocity (°/s) over the moves in the window before `now`, capped. */
export function releaseVelocity(moves: readonly Move[], now: number): [number, number] {
  const recent = moves.filter((m) => now - m.t <= VELOCITY_WINDOW_MS);
  if (recent.length === 0) return [0, 0];
  // Span from the moment before the first counted move: at least one 60 Hz frame.
  const span = Math.max(1000 / 60, now - (recent[0] as Move).t) / 1000;
  let lon = recent.reduce((a, m) => a + m.dLon, 0) / span;
  let lat = recent.reduce((a, m) => a + m.dLat, 0) / span;
  const speed = Math.hypot(lon, lat);
  if (speed > MAX_FLING_DEG_S) {
    lon *= MAX_FLING_DEG_S / speed;
    lat *= MAX_FLING_DEG_S / speed;
  }
  return [lon, lat];
}

export function attachInput(canvas: HTMLCanvasElement, deps: InputDeps): InputState {
  const { camera } = deps;
  const state = { dragging: false };
  const moves: Move[] = [];
  let last: { x: number; y: number; t: number } | null = null;
  let downAt: { x: number; y: number } | null = null;
  /** Active pointers (CSS px), for two-finger pinch. */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { startDist: number } | null = null;

  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const pinchMid = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  };
  const release = (at: { x: number; y: number }) => {
    deps.onStretchRelease(camera.releaseStretch(), at);
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    camera.stop();
    deps.touched();
    if (pointers.size === 2) {
      // Second finger: the drag becomes a pinch; it is never a tap.
      state.dragging = false;
      downAt = null;
      pinch = { startDist: Math.max(1, pinchDist()) };
      return;
    }
    state.dragging = true;
    last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    downAt = { x: e.clientX, y: e.clientY };
    moves.length = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    deps.touched();
    if (pinch !== null) {
      camera.holdStretch(Math.log(pinchDist() / pinch.startDist));
      deps.invalidate();
      return;
    }
    if (!state.dragging || last === null) return;
    const k = deps.degreesPerPx();
    const dLon = -(e.clientX - last.x) * k;
    const dLat = (e.clientY - last.y) * k;
    camera.pan(dLon, dLat);
    moves.push({ t: e.timeStamp, dLon, dLat });
    while (moves.length > 0 && e.timeStamp - (moves[0] as Move).t > VELOCITY_WINDOW_MS)
      moves.shift();
    last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    deps.invalidate();
  });

  const endDrag = (e: PointerEvent) => {
    const wasPinch = pinch !== null;
    const mid = pinchMid();
    pointers.delete(e.pointerId);
    deps.touched();
    deps.invalidate();
    if (wasPinch) {
      if (pointers.size < 2) {
        pinch = null;
        release(mid);
      }
      return; // the finger left on the glass does not start a drag until it lifts
    }
    if (!state.dragging) return;
    state.dragging = false;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < TAP_SLOP_PX) {
      deps.onTap({ x: e.clientX, y: e.clientY });
      return;
    }
    // A pause before letting go leaves no moves in the window: velocity 0, no fling.
    camera.fling(...releaseVelocity(moves, e.timeStamp));
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // Mouse wheel and trackpad pinch (ctrl+wheel) stretch the zoom the same way.
  let wheelRaw = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault(); // no page zoom on ctrl+wheel
      camera.stop();
      deps.touched();
      wheelRaw -= e.deltaY * (e.ctrlKey ? 0.01 : 0.0025);
      camera.holdStretch(wheelRaw);
      deps.invalidate();
      clearTimeout(wheelTimer);
      const at = { x: e.clientX, y: e.clientY };
      wheelTimer = setTimeout(() => {
        wheelRaw = 0;
        release(at);
      }, WHEEL_GESTURE_MS);
    },
    { passive: false },
  );

  return state;
}
