/**
 * Where a vote counts (README §5.6, decided 2026-11-09). Pure, so every row of the table in
 * docs/design/phase-5-api.md §2 is a unit test.
 */
import { isKnownCountry } from "@world-emotion/geo-data";

/** Codes Cloudflare documents as "not a country": unknown (XX) and Tor (T1). Not worth logging. */
const NOT_A_COUNTRY = new Set(["XX", "T1"]);

export interface Connection {
  /** The connection's country when it is one we know; otherwise null. */
  readonly conn: string | null;
  /** A code we did not recognise and should log (e.g. Kosovo's, unverified: geo-decisions G5). */
  readonly unrecognised: string | null;
}

export function connection(cfCountry: string | undefined | null): Connection {
  if (!cfCountry) return { conn: null, unrecognised: null };
  if (isKnownCountry(cfCountry)) return { conn: cfCountry, unrecognised: null };
  return { conn: null, unrecognised: NOT_A_COUNTRY.has(cfCountry) ? null : cfCountry };
}

export interface Placement {
  /** What goes in `votes.country`. A pick that does not count is never stored (decision A3). */
  readonly stored: string | null;
  readonly counted: "country" | "world";
}

/** `picked` must already be validated (format and isKnownCountry). */
export function place(picked: string | undefined, conn: string | null): Placement {
  if (conn === null) return { stored: null, counted: "world" };
  if (picked === undefined || picked === conn) return { stored: conn, counted: "country" };
  return { stored: null, counted: "world" };
}
