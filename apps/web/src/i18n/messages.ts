import type { Continent } from "@world-emotion/shared";

/**
 * Every piece of UI text, per language (docs/design/phase-4.5-i18n.md). English defines the shape;
 * every other catalogue must match it exactly (the type, and i18n.test.ts at runtime).
 *
 * Templates use `{name}` placeholders and are split where a styled or animated value goes (the
 * mood word, the ticking count), so word order belongs to the translation, never to code.
 *
 * Moods: in sentences they are NOUNS ("le monde ressent du calme", "Francia siente calma"), not
 * adjectives: an adjective would have to agree with the subject's gender, and country names have
 * genders. `label` is the short word on a face or bar; `feels` is the form that fills `{mood}`.
 */

/** Six of a kind, indexed by mood id (happy, calm, excited, stressed, sad, angry). */
export type PerMood = readonly [string, string, string, string, string, string];

/** Number formatting for the active language, passed to messages that count things. */
export interface Fmt {
  /** "28,378" / "28 378" / "28.378" */
  n(x: number): string;
  /** CLDR plural category: "one", "other", and "many" in some languages. */
  plural(x: number): Intl.LDMLPluralRule;
  /** A whole percentage (0–100): "42%" / "42 %". */
  pct(x: number): string;
}

export interface Messages {
  readonly meta: {
    /** The language's own name, shown in the switcher ("Français"). */
    readonly name: string;
    /** BCP 47 tag for <html lang> and Intl ("fr", "es-419", "pt-BR"). */
    readonly tag: string;
    /** Who reviewed it and when (docs/design/phase-4.5-i18n.md §2, Review). */
    readonly reviewedBy: string;
    readonly reviewedOn: string;
  };
  readonly pageTitle: string;
  /** The globe canvas, for screen readers. */
  readonly globeLabel: string;

  readonly rightNow: string;
  /** "{mood}" is the animated, coloured mood noun. */
  readonly worldFeels: string;
  /** "{count}" is the ticking number; pick the template by plural category of `n`. */
  readonly feelingNow: (n: number, f: Fmt) => string;
  /** The headline while the world has fewer check-ins than the privacy floor (ADR 0003). */
  readonly worldQuiet: string;
  /** The count line under it: "{count} check-ins so far". */
  readonly quietCount: (n: number, f: Fmt) => string;
  readonly back: string;

  readonly moods: { readonly label: PerMood; readonly feels: PerMood };
  /** Theme names under the headline, by world mood (Overgrown Earth, Waterworld, …). */
  readonly themes: PerMood;
  readonly continents: Readonly<Record<Continent, string>>;

  readonly region: {
    /** Second line of the card under the place name; "{mood}" is coloured. */
    readonly feels: string;
    readonly checkIns: (n: number, f: Fmt) => string;
    readonly none: string;
    readonly quiet: string;
    /** "{continent}" */
    readonly quietShowing: string;
    readonly showBreakdown: string;
    readonly hideBreakdown: string;
  };

  readonly checkin: {
    readonly label: string;
    readonly ask: string;
    /** "{mood}" is coloured. */
    readonly youFeel: string;
    readonly change: string;
    readonly move: string;
    readonly showMe: string;
    readonly whereAreYou: string;
    readonly tapYourCountry: string;
    readonly tooSmall: string;
    readonly typeIt: string;
    readonly noMatch: string;
    readonly cancel: string;
  };

  readonly language: {
    /** The switcher's accessible name. */
    readonly menu: string;
    readonly suggest: string;
  };
}

/** Split a template at `{key}`: the text before and after, for a value rendered in between. */
export function around(template: string, key: string): [string, string] {
  const at = template.indexOf(`{${key}}`);
  if (at < 0) return [template, ""];
  return [template.slice(0, at), template.slice(at + key.length + 2)];
}

/** Fill `{key}` placeholders with plain text. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}
