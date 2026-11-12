import type { Messages } from "./messages";

/**
 * French. Informal "tu" (the app is casual). Moods are nouns with their partitive article in
 * sentences ("le monde ressent de la joie"), so nothing agrees with a country's gender.
 * Typography: a non-breaking space before ":" and "?".
 */
export const fr: Messages = {
  meta: {
    name: "Français",
    tag: "fr",
    reviewedBy: "Claude (not native)",
    reviewedOn: "2026-11-09",
  },
  pageTitle: "World Emotion",
  globeLabel: "Globe montrant ce que ressent le monde. Touche un pays pour explorer son continent.",

  loading: "Chargement du globe…",
  failed: "La carte n’a pas pu se charger.",
  retry: "Réessayer",

  rightNow: "En ce moment",
  worldFeels: "Le monde ressent {mood}",
  // CLDR French: 0 and 1 are "one" ("0 personne ressent"), which is correct French. No "en ce
  // moment": the kicker right above says it, and the line wrapped at 360 px (screenshot review).
  feelingNow: (n, f) =>
    f.plural(n) === "one"
      ? "{count} personne ressent quelque chose"
      : "{count} personnes ressentent quelque chose",
  // Not « calme » : c'est aussi l'humeur « calm ». Silencieux = personne n'a encore parlé.
  worldQuiet: "Le monde est encore silencieux",
  quietCount: (n, f) =>
    f.plural(n) === "one"
      ? "{count} humeur partagée pour l’instant"
      : "{count} humeurs partagées pour l’instant",
  back: "← Monde",

  moods: {
    label: ["joie", "calme", "enthousiasme", "stress", "tristesse", "colère"],
    feels: [
      "de la joie",
      "du calme",
      "de l’enthousiasme",
      "du stress",
      "de la tristesse",
      "de la colère",
    ],
  },
  themes: [
    "Terre verdoyante",
    "Monde englouti",
    "Terre illuminée",
    "Terre parasitée",
    "Terre glaciaire",
    "Terre de braises",
  ],
  continents: {
    AF: "Afrique",
    AN: "Antarctique",
    AS: "Asie",
    EU: "Europe",
    NA: "Amérique du Nord",
    OC: "Océanie",
    SA: "Amérique du Sud",
  },

  region: {
    feels: "ressent {mood}",
    checkIns: (n, f) =>
      `${f.n(n)} ${f.plural(n) === "one" ? "humeur partagée" : "humeurs partagées"}`,
    none: "Aucune humeur partagée pour l’instant",
    quiet: "Peu de monde ici",
    quietShowing: "Peu de monde ici : on affiche {continent}",
    showBreakdown: "Voir le détail",
    hideBreakdown: "Masquer le détail",
  },

  checkin: {
    label: "Partager ton humeur",
    ask: "Comment te sens-tu en ce moment ?",
    youFeel: "Tu ressens {mood}",
    change: "changer",
    move: "déplacer",
    showMe: "choisir",
    whereAreYou: "Où es-tu ?",
    yourCountry: "Ton pays :",
    notYou: "ce n’est pas ça ?",
    tapYourCountry: "Touche ton pays sur le globe",
    tooSmall: "Trop petit pour le toucher ?",
    typeIt: "Tape son nom…",
    noMatch: "Aucun résultat",
    cancel: "annuler",
    likeCountry: (n, f) =>
      f.plural(n) === "one"
        ? "Comme {count} autre personne dans ton pays"
        : "Comme {count} autres personnes dans ton pays",
    likeWorld: (n, f) =>
      f.plural(n) === "one"
        ? "Comme {count} autre personne dans le monde"
        : "Comme {count} autres personnes dans le monde",
    firstCountry: "La première personne à le ressentir dans ton pays",
    firstWorld: "La première personne à le ressentir dans le monde",
    early: (n, f) =>
      f.plural(n) === "one" && n === 1
        ? "La première humeur partagée en ce moment"
        : "Parmi les {count} premières humeurs partagées",
    countryFeels: "Ton pays ressent {mood}",
    smallCountry: "Il faut {n} réponses pour voir l’humeur de ton pays.",
  },

  journal: {
    label: "Tes 7 derniers jours",
    none: "rien",
    onDevice: "Gardé uniquement sur cet appareil",
    clear: "effacer",
  },

  hints: { tapCountry: "Touche un pays" },

  language: { menu: "Langue", suggest: "Proposer une meilleure traduction" },
};
