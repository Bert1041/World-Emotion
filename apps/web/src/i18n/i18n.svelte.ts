import {
  CATALOGUES,
  type Locale,
  makeCountryName,
  makeFmt,
  pickLocale,
  suggestUrl,
} from "./locale";
import type { Messages } from "./messages";

const STORAGE_KEY = "world-emotion.lang";

/**
 * The active language. Components read `i18n.t` (messages), `i18n.fmt` (numbers, plurals) and
 * `i18n.country(code)`; all re-render when the language changes.
 */
class I18n {
  locale: Locale = $state("en");
  readonly t: Messages = $derived(CATALOGUES[this.locale]);
  readonly fmt = $derived(makeFmt(this.locale));
  readonly country = $derived(makeCountryName(this.locale));
  readonly suggestUrl = $derived(suggestUrl(this.locale, location.href));

  /** Pick the language on start (before the UI mounts, so there is no English flash). */
  init(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked storage: follow the browser.
    }
    const forced = new URLSearchParams(location.search).get("lang");
    this.apply(pickLocale(navigator.languages ?? [navigator.language], stored, forced));
  }

  /** The switcher: change now and remember on this device. */
  choose(l: Locale): void {
    this.apply(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Not remembered; still applied for this visit.
    }
  }

  private apply(l: Locale): void {
    this.locale = l;
    const m = CATALOGUES[l];
    document.documentElement.lang = m.meta.tag;
    document.title = m.pageTitle;
    // The globe canvas is outside the Svelte tree (index.html).
    document.getElementById("fx")?.setAttribute("aria-label", m.globeLabel);
  }
}

export const i18n = new I18n();
