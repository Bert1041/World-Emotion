/**
 * Whether a vote counts at `now`. The window is half-open: (now - windowSeconds, now].
 * A vote exactly `windowSeconds` old has expired; a future-dated vote (clock skew) never counts.
 * The aggregator's SQL must use the same bounds: see `windowBounds`.
 */
export function isActive(createdAt: number, now: number, windowSeconds: number): boolean {
  return createdAt > now - windowSeconds && createdAt <= now;
}

/** SQL-ready bounds: `created_at > after AND created_at <= until`. */
export function windowBounds(now: number, windowSeconds: number): { after: number; until: number } {
  return { after: now - windowSeconds, until: now };
}
