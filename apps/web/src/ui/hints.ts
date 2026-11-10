/**
 * One-time hints (bridge U6): shown the first time something happens on this device, never
 * again. The flag is a per-device convenience in localStorage; with storage blocked the hint
 * shows every time, which is the harmless direction.
 */
export interface FlagStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HINT_TAP_COUNTRY = "we.hint.tapCountry";

/** True the first time this is asked for `key` on this device; the flag is set as a side effect. */
export function firstTime(key: string, store: FlagStore | null = defaultStore()): boolean {
  if (store === null) return true;
  try {
    if (store.getItem(key) !== null) return false;
    store.setItem(key, "1");
  } catch {
    // quota or privacy mode: treat as first time
  }
  return true;
}

function defaultStore(): FlagStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access itself can throw in some privacy modes
  }
}
