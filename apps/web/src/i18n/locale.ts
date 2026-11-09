import { en } from "./en";
import { es419 } from "./es-419";
import { fr } from "./fr";
import type { Fmt, Messages } from "./messages";
import { ptBR } from "./pt-BR";

/**
 * The languages we ship (docs/design/phase-4.5-i18n.md). All four are bundled: each is ~1–2 KB
 * gzipped, and loading one lazily would either flash English or hold the whole app for a fetch.
 */
export const CATALOGUES = { en, fr, "es-419": es419, "pt-BR": ptBR } as const satisfies Record<
  string,
  Messages
>;
export type Locale = keyof typeof CATALOGUES;
export const LOCALES = Object.keys(CATALOGUES) as Locale[];

/** Browser languages by their primary subtag: every Spanish → es-419, every Portuguese → pt-BR. */
const BY_PRIMARY: Readonly<Record<string, Locale>> = {
  en: "en",
  fr: "fr",
  es: "es-419",
  pt: "pt-BR",
};

const asLocale = (tag: string | null | undefined): Locale | null => {
  if (!tag) return null;
  if (tag in CATALOGUES) return tag as Locale;
  return BY_PRIMARY[tag.toLowerCase().split(/[-_]/)[0] ?? ""] ?? null;
};

/**
 * Which language to show: `?lang=` (testing), then the device's stored choice, then the first of
 * the browser's languages we ship, else English.
 */
export function pickLocale(
  browser: readonly string[],
  stored: string | null,
  forced: string | null,
): Locale {
  for (const tag of [forced, stored, ...browser]) {
    const l = asLocale(tag);
    if (l !== null) return l;
  }
  return "en";
}

export function makeFmt(locale: Locale): Fmt {
  const tag = CATALOGUES[locale].meta.tag;
  const num = new Intl.NumberFormat(tag);
  const rules = new Intl.PluralRules(tag);
  const pct = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 });
  return {
    n: (x) => num.format(x),
    plural: (x) => rules.select(x),
    pct: (x) => pct.format(x / 100),
  };
}

/** Country names in a language, falling back to English, then to the code. */
export function makeCountryName(locale: Locale): (code: string) => string {
  const own = new Intl.DisplayNames([CATALOGUES[locale].meta.tag, "en"], { type: "region" });
  return (code) => {
    try {
      return own.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/** A prefilled GitHub issue for a translation fix (no backend; decided 2026-11-09). */
export function suggestUrl(locale: Locale, page: string): string {
  const m = CATALOGUES[locale];
  const q = new URLSearchParams({
    title: `Translation (${m.meta.name}): `,
    body: `Language: ${m.meta.name} (${m.meta.tag})\nWhere: ${page}\n\nWhat it says now:\n\nWhat it should say:\n`,
  });
  return `https://github.com/Bert1041/World-Emotion/issues/new?${q}`;
}
