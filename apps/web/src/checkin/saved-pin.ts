/** Your pin, remembered on this device (a per-device convenience, never sent anywhere). */
export interface Pin {
  readonly code: string;
  readonly lonLat: [number, number];
}

export const PIN_KEY = "we.pin";

/** The saved pin, if it is well-formed and names a country we can draw. */
export function parseSavedPin(raw: string | null, known: ReadonlyMap<string, unknown>): Pin | null {
  try {
    const p = JSON.parse(raw ?? "null") as { code?: unknown; lon?: unknown; lat?: unknown } | null;
    if (
      p &&
      typeof p.code === "string" &&
      known.has(p.code) &&
      typeof p.lon === "number" &&
      typeof p.lat === "number" &&
      Math.abs(p.lat) <= 90
    )
      return { code: p.code, lonLat: [p.lon, p.lat] };
  } catch {
    // corrupt: fall back to the guess
  }
  return null;
}
