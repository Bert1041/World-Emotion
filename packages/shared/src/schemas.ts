import { z } from "zod";
import { CONTINENTS } from "./continents";
import { MOOD_COUNT, MOOD_IDS } from "./moods";

/** Published distributions are rounded, so they sum to 1 only within this tolerance. */
export const DIST_SUM_TOLERANCE = 0.001;

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, upper case");
export const continentSchema = z.enum(CONTINENTS);
/** Parses to the `MoodId` union, not `number`, so no cast is needed downstream. */
export const moodIdSchema = z.literal(MOOD_IDS);

// ---------------------------------------------------------------------------------------------
// Check-in request (client → API). Strict: unknown keys are rejected, not ignored.
// ---------------------------------------------------------------------------------------------

export const checkinRequestSchema = z.strictObject({
  mood: moodIdSchema,
  /** Manual override only; normally the server derives the country from the request. */
  country: countryCodeSchema.optional(),
  /** Idempotency key. A replay with the same id is a no-op on the server (README G7). */
  checkinId: z.uuid(),
});
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Public snapshot v1 (aggregator → R2 → every client).
// ---------------------------------------------------------------------------------------------

const probability = z.number().min(0).max(1);

export const publishedDistSchema = z
  .array(probability)
  .length(MOOD_COUNT)
  .refine((d) => Math.abs(d.reduce((a, b) => a + b, 0) - 1) <= DIST_SUM_TOLERANCE, {
    message: `distribution must sum to 1 ± ${DIST_SUM_TOLERANCE}`,
  });

export const snapshotRegionSchema = z.strictObject({
  /** Raw vote count in the window (not shrunk), so the UI can show "quiet here". */
  n: z.int().nonnegative(),
  /** Final distribution: shrunk and smoothed. Clients render it as-is. */
  dist: publishedDistSchema,
  /** Headline mood after hysteresis (decision P1), so every client shows the same word. */
  h: moodIdSchema,
});
export type SnapshotRegion = z.infer<typeof snapshotRegionSchema>;

export const SNAPSHOT_VERSION = 1;

export const snapshotSchema = z.strictObject({
  v: z.literal(SNAPSHOT_VERSION),
  generatedAt: z.int().nonnegative(),
  windowSeconds: z.int().positive(),
  world: snapshotRegionSchema,
  /** Regions below the privacy floor are absent; the client falls back to the parent. */
  continents: z.partialRecord(continentSchema, snapshotRegionSchema),
  countries: z.record(countryCodeSchema, snapshotRegionSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Client-side guard: an unknown version or malformed file is rejected; keep the last good one. */
export function parseSnapshot(input: unknown): ParseResult<Snapshot> {
  const r = snapshotSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

// ---------------------------------------------------------------------------------------------
// Private aggregator state (aggregator ↔ R2 only; never published). README G4.
// Holds unrounded distributions for *every* region, including those below the privacy floor,
// so smoothing and hysteresis stay continuous when a region crosses the floor.
// ---------------------------------------------------------------------------------------------

export const stateRegionSchema = z.strictObject({
  n: z.int().nonnegative(),
  dist: z.array(probability).length(MOOD_COUNT),
  headline: moodIdSchema,
  challenger: moodIdSchema.nullable(),
  streak: z.int().nonnegative(),
});
export type StateRegion = z.infer<typeof stateRegionSchema>;

export const AGGREGATOR_STATE_VERSION = 1;

export const aggregatorStateSchema = z.strictObject({
  v: z.literal(AGGREGATOR_STATE_VERSION),
  generatedAt: z.int().nonnegative(),
  world: stateRegionSchema,
  continents: z.partialRecord(continentSchema, stateRegionSchema),
  countries: z.record(countryCodeSchema, stateRegionSchema),
});
export type AggregatorState = z.infer<typeof aggregatorStateSchema>;

export function parseAggregatorState(input: unknown): ParseResult<AggregatorState> {
  const r = aggregatorStateSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
