import type { Messages } from "./messages";

export const en: Messages = {
  meta: { name: "English", tag: "en", reviewedBy: "source", reviewedOn: "2026-11-09" },
  pageTitle: "World Emotion",
  globeLabel: "Globe showing how the world feels. Tap a country to explore its continent.",

  loading: "Loading the globe…",
  failed: "The map didn’t load.",
  retry: "Try again",

  rightNow: "Right now",
  worldFeels: "The world feels {mood}",
  // "1 feeling something right now" reads fine in English; other languages differ.
  feelingNow: () => "{count} feeling something right now",
  worldQuiet: "The world is quiet",
  quietCount: (n, f) =>
    f.plural(n) === "one" ? "{count} check-in so far" : "{count} check-ins so far",
  back: "← World",

  moods: {
    label: ["happy", "calm", "excited", "stressed", "sad", "angry"],
    feels: ["happy", "calm", "excited", "stressed", "sad", "angry"],
  },
  themes: [
    "Overgrown Earth",
    "Waterworld",
    "City-lights Earth",
    "Static Earth",
    "Ice-age Earth",
    "Ember Earth",
  ],
  continents: {
    AF: "Africa",
    AN: "Antarctica",
    AS: "Asia",
    EU: "Europe",
    NA: "North America",
    OC: "Oceania",
    SA: "South America",
  },

  region: {
    feels: "feels {mood}",
    // Was "1 check-ins" before plural rules (found 2026-11-09).
    checkIns: (n, f) => `${f.n(n)} ${f.plural(n) === "one" ? "check-in" : "check-ins"}`,
    none: "No check-ins yet",
    quiet: "Quiet here",
    quietShowing: "Quiet here: showing {continent}",
    showBreakdown: "Show the breakdown",
    hideBreakdown: "Hide the breakdown",
  },

  checkin: {
    label: "Check in",
    ask: "How do you feel right now?",
    youFeel: "You feel {mood}",
    change: "change",
    move: "move",
    showMe: "show me",
    whereAreYou: "Where are you?",
    yourCountry: "Your country:",
    notYou: "not you?",
    tapYourCountry: "Tap your country on the globe",
    tooSmall: "Too small to tap?",
    typeIt: "Type it…",
    noMatch: "No match",
    cancel: "cancel",
    likeCountry: (n, f) =>
      f.plural(n) === "one"
        ? "Like {count} other in your country"
        : "Like {count} others in your country",
    likeWorld: (n, f) =>
      f.plural(n) === "one"
        ? "Like {count} other in the world"
        : "Like {count} others in the world",
    firstCountry: "The first to feel this in your country right now",
    firstWorld: "The first to feel this in the world right now",
    early: (n, f) =>
      f.plural(n) === "one"
        ? "The first to check in right now"
        : "One of the first {count} to check in",
    countryFeels: "Your country feels {mood}",
    smallCountry: "Your country needs {n} check-ins to show its own mood.",
  },

  journal: {
    label: "Your last 7 days",
    none: "no check-in",
    onDevice: "Kept only on this device",
    clear: "clear",
  },

  hints: { tapCountry: "Tap a country" },

  language: { menu: "Language", suggest: "Suggest a better translation" },
};
