# Phase 4.5 design: internationalisation

Status: **approved** (2026-11-09). English, French, Latin-American Spanish (`es-419`), Brazilian
Portuguese (`pt-BR`); the language follows the browser, with a small switcher remembered on the
device; own branch and PR after Phase 4. **Review:** no paid or native reviewers ("I can't afford a
translator"): Claude drafts and reviews (§2, Review), all four languages ship visible, and users can
suggest corrections. Theme names are translated (I1); the switcher sits top-right (I2).

## 1. What there is to translate (inventory, 2026-11-09)

| Where | Text | Notes |
|---|---|---|
| Header (App.svelte) | "Right now", "The world feels {mood}", "{n} feeling something right now", "← World" | Sentence with a mood word and a number |
| Theme names (engine/themes.ts) | Overgrown Earth, Waterworld, City-lights Earth, Simulation Earth, Ice-age Earth, Ruined Earth | Flavour names, shown under the headline |
| Moods (packages/shared MOODS) | happy, calm, excited, stressed, sad, angry | Today the data ids double as labels |
| Continents (engine/camera.ts) | Africa, Antarctica, Asia, Europe, North America, Oceania, South America | |
| Region card (main.ts, Panel.svelte) | "Right now", "{place} feels {mood}", "{n} check-ins", "No check-ins yet", "Quiet here", "Quiet here: showing {continent}", Show/Hide the breakdown | Built with template strings today |
| Check-in bar (CheckIn.svelte) | "How do you feel right now?", "You feel {mood}", change, move, show me, "Where are you?", "Tap your country on the globe", "Too small to tap?", "Type it…", "No match", cancel, aria "Check in" | |
| Page | `<title>`, the globe's aria-label, `<html lang>` | |
| Already localised | Country names (`Intl.DisplayNames`), the world count (`Intl.NumberFormat`) | Both use the browser language, not a chosen one: they must follow the switcher |

About 60 strings. **Existing English bug found:** `${n} check-ins` reads "1 check-ins"; plural rules
fix it in every language.

## 2. Design

- **No library.** One typed catalogue per language (`apps/web/src/i18n/en.ts`, `fr.ts`, …): English
  defines the keys; the others must have exactly those keys (a compile error and a test). Messages
  are functions where they take values, so word order and agreement live in the translation:
  `regionFeels: (place, mood) => \`${place} se sent ${mood}\``. Plurals use `Intl.PluralRules`
  (`one`/`other`, plus `many` where a language has it), numbers `Intl.NumberFormat(locale)`.
  Rationale: ~60 strings; a library (Paraglide, i18next) adds build steps or ~10–40 KB for features
  we do not use; the budget test keeps us honest either way.
- **Moods: ids stay English in data; labels are translated.** French adjectives agree in gender
  ("calme" either way, but "heureux/heureuse"); the mood words are shown alone (a label, "the world
  feels …"), so each language picks one neutral form, chosen and noted in the review.
- **Choosing the language.** First visit: the first of `navigator.languages` whose language we ship
  (`fr-CA` → French, `es-AR` → es-419, `pt-PT` → pt-BR), else English. The switcher stores the
  choice in `localStorage` (wrapped in try/catch). `?lang=fr` forces a language for testing.
- **Loading.** English is in the main bundle; others are separate chunks loaded before first paint
  of text (they are ~2 KB each; the wait is one small request, and the globe draws meanwhile).
- **Country search** matches names in the active language and in English (people type either).
- **Switcher.** A small "EN ▾" button in the header's corner, keyboard-reachable, never over the
  Earth (the layout rule test covers it at all 11 viewports).
- **Variants.** `es-419` serves every Spanish browser (`es`, `es-ES`, `es-MX`, …) and `pt-BR` every
  Portuguese one: the most speakers, and understood everywhere. Neutral Latin-American Spanish (no
  "vos", no regional slang); "tú" for the reader, as the app is informal.
- **Review (Claude, not a native speaker).** For each language: a glossary first (one word per idea,
  every screen), tone notes per mood word (why "stressé·e", not "anxieux"), then a back-translation
  of every string to English, compared with the source to catch meaning drift. Each catalogue
  records `reviewedBy: "Claude (not native)"` and the date. The risk this leaves: wording that is
  correct but feels slightly off to a local.
- **Corrections from users.** The language menu ends with "Suggest a better translation", a link
  to a prefilled GitHub issue (no backend; Phase 7 may move it). Native speakers among users fix
  what the review misses.

## 3. Exit criteria

1. A test fails if any catalogue misses or adds a key compared with English (mutation: delete one).
2. In a real browser, each language shows no English UI text (a test walks every screen: world,
   zoomed card, check-in, pick mode, search, and checks every visible text node against the English
   catalogue).
3. Plurals: 0, 1, 2, 5, 21, 1000 render correctly in each language (unit test with `PluralRules`).
4. Layout rule passes on all 11 viewports in the longest language (likely Portuguese or French).
5. Initial-JS budget still met (English in the main bundle only).
6. Country names and the count follow the switcher, not just the browser (test: browser `en`,
   switch to `fr`, see "Allemagne").
7. Each catalogue has a glossary and tone notes, and the back-translation table is in the doc;
   any string whose back-translation changed meaning is fixed or explained.

## 4. Not in scope

Right-to-left languages (Arabic deferred), translated privacy page (Phase 7 writes it), server
messages (Phase 5+), date formats (none shown yet).

## 5. Decisions (2026-11-09)

- **I1. Theme names: translated**, as natural equivalents, not word for word.
- **I2. Switcher: the header's top-right corner**, small and quiet.
- **I3. Review: Claude**, not paid or native reviewers; all languages visible; user suggestions.
- **Variants: `es-419` and `pt-BR`.**
