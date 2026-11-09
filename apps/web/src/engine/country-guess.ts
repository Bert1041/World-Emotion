/**
 * Decision M2 (docs/design/phase-4-motion.md §6): until the server derives the country from the
 * request (Phase 5), a demo check-in guesses it from the browser's language region, with a
 * "change" control. No location permission is asked for.
 */
export function guessCountry(
  languages: readonly string[],
  known: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string | null {
  for (const tag of languages) {
    let region: string | undefined;
    try {
      const loc = new Intl.Locale(tag);
      // "en-NG" names the region; "en" alone does not, so use its likely region (en → US).
      region = loc.region ?? loc.maximize().region;
    } catch {
      continue; // malformed tag
    }
    // Only real ISO 3166 countries we can draw: not "001" (world) or "419" (Latin America).
    if (region !== undefined && /^[A-Z]{2}$/.test(region) && known.has(region)) return region;
  }
  return null;
}
