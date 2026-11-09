import type { Messages } from "./messages";

/**
 * Latin-American Spanish (es-419), served to every Spanish browser. Neutral: "tú", no "vos", no
 * regional slang; "enojo" (not Spain's "enfado"). Moods are nouns in sentences ("Francia siente
 * calma"), so nothing agrees with a country's gender.
 */
export const es419: Messages = {
  meta: {
    name: "Español",
    tag: "es-419",
    reviewedBy: "Claude (not native)",
    reviewedOn: "2026-11-09",
  },
  pageTitle: "World Emotion",
  globeLabel:
    "Globo que muestra cómo se siente el mundo. Toca un país para explorar su continente.",

  rightNow: "Ahora mismo",
  worldFeels: "El mundo siente {mood}",
  // CLDR Spanish: "one" for 1 only; large round numbers can be "many", so test for "one".
  feelingNow: (n, f) =>
    f.plural(n) === "one"
      ? "{count} persona siente algo ahora mismo"
      : "{count} personas sienten algo ahora mismo",
  back: "← Mundo",

  moods: {
    label: ["alegría", "calma", "entusiasmo", "estrés", "tristeza", "enojo"],
    feels: ["alegría", "calma", "entusiasmo", "estrés", "tristeza", "enojo"],
  },
  themes: [
    "Tierra frondosa",
    "Mundo sumergido",
    "Tierra iluminada",
    "Tierra simulada",
    "Tierra glacial",
    "Tierra en ruinas",
  ],
  continents: {
    AF: "África",
    AN: "Antártida",
    AS: "Asia",
    EU: "Europa",
    NA: "América del Norte",
    OC: "Oceanía",
    SA: "América del Sur",
  },

  region: {
    feels: "siente {mood}",
    checkIns: (n, f) => `${f.n(n)} ${f.plural(n) === "one" ? "respuesta" : "respuestas"}`,
    none: "Todavía no hay respuestas",
    quiet: "Poca gente por aquí",
    quietShowing: "Poca gente por aquí: mostrando {continent}",
    showBreakdown: "Ver el detalle",
    hideBreakdown: "Ocultar el detalle",
  },

  checkin: {
    label: "Compartir cómo te sientes",
    ask: "¿Cómo te sientes ahora mismo?",
    youFeel: "Sientes {mood}",
    change: "cambiar",
    move: "mover",
    showMe: "elegir",
    whereAreYou: "¿Dónde estás?",
    tapYourCountry: "Toca tu país en el globo",
    tooSmall: "¿Muy pequeño para tocarlo?",
    typeIt: "Escríbelo…",
    noMatch: "Sin resultados",
    cancel: "cancelar",
  },

  language: { menu: "Idioma", suggest: "Sugerir una mejor traducción" },
};
