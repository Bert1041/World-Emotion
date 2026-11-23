/**
 * Your connection's country as the API last reported it (decision L3: learnt from the first
 * check-in's answer, remembered on this device), so the bar can warn before a tap that a pick in
 * another country counts for the world only. A per-device convenience; never sent anywhere.
 */
export const CONN_KEY = "we.conn";

/** A remembered code, if it is one we can draw; anything else reads as unknown. */
export function parseConn(raw: string | null, known: ReadonlyMap<string, unknown>): string | null {
  return raw !== null && /^[A-Z]{2}$/.test(raw) && known.has(raw) ? raw : null;
}

export function loadConn(known: ReadonlyMap<string, unknown>): string | null {
  try {
    return parseConn(localStorage.getItem(CONN_KEY), known);
  } catch {
    return null; // storage blocked
  }
}

export function saveConn(code: string | null): void {
  try {
    if (code === null) localStorage.removeItem(CONN_KEY);
    else localStorage.setItem(CONN_KEY, code);
  } catch {
    // a convenience only
  }
}
