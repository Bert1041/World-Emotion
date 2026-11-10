import type { Messages } from "./messages";

/**
 * Brazilian Portuguese (pt-BR), served to every Portuguese browser. "Você" (standard in Brazil).
 * Moods are nouns in sentences ("O mundo sente calma"), so nothing agrees with a country's gender.
 * Plural: CLDR puts 0 in "one" for Portuguese ("0 pessoa"), which Brazilians rarely say; this
 * catalogue uses the singular for exactly 1.
 */
export const ptBR: Messages = {
  meta: {
    name: "Português",
    tag: "pt-BR",
    reviewedBy: "Claude (not native)",
    reviewedOn: "2026-11-09",
  },
  pageTitle: "World Emotion",
  globeLabel:
    "Globo mostrando como o mundo se sente. Toque em um país para explorar o continente dele.",

  loading: "Carregando o globo…",
  failed: "O mapa não carregou.",
  retry: "Tentar de novo",

  rightNow: "Agora mesmo",
  worldFeels: "O mundo sente {mood}",
  feelingNow: (n) =>
    n === 1 ? "{count} pessoa sentindo algo agora" : "{count} pessoas sentindo algo agora",
  worldQuiet: "O mundo está em silêncio",
  quietCount: (n) => (n === 1 ? "{count} resposta até agora" : "{count} respostas até agora"),
  back: "← Mundo",

  moods: {
    label: ["alegria", "calma", "empolgação", "estresse", "tristeza", "raiva"],
    feels: ["alegria", "calma", "empolgação", "estresse", "tristeza", "raiva"],
  },
  themes: [
    "Terra verdejante",
    "Mundo submerso",
    "Terra iluminada",
    "Terra de chuvisco",
    "Terra glacial",
    "Terra de brasas",
  ],
  continents: {
    AF: "África",
    AN: "Antártida",
    AS: "Ásia",
    EU: "Europa",
    NA: "América do Norte",
    OC: "Oceania",
    SA: "América do Sul",
  },

  region: {
    feels: "sente {mood}",
    checkIns: (n, f) => `${f.n(n)} ${n === 1 ? "resposta" : "respostas"}`,
    none: "Ainda sem respostas",
    quiet: "Pouca gente por aqui",
    quietShowing: "Pouca gente por aqui: mostrando {continent}",
    showBreakdown: "Ver detalhes",
    hideBreakdown: "Ocultar detalhes",
  },

  checkin: {
    label: "Compartilhar como você se sente",
    ask: "Como você se sente agora?",
    youFeel: "Você sente {mood}",
    change: "mudar",
    move: "mover",
    showMe: "escolher",
    whereAreYou: "Onde você está?",
    yourCountry: "Seu país:",
    notYou: "não é aqui?",
    tapYourCountry: "Toque no seu país no globo",
    tooSmall: "Pequeno demais para tocar?",
    typeIt: "Digite o nome…",
    noMatch: "Nada encontrado",
    cancel: "cancelar",
    likeCountry: (n) =>
      n === 1 ? "Como mais {count} pessoa no seu país" : "Como mais {count} pessoas no seu país",
    likeWorld: (n) =>
      n === 1 ? "Como mais {count} pessoa no mundo" : "Como mais {count} pessoas no mundo",
    firstCountry: "A primeira pessoa a sentir isso no seu país agora",
    firstWorld: "A primeira pessoa a sentir isso no mundo agora",
    early: (n) => (n === 1 ? "A primeira resposta agora" : "Entre as primeiras {count} respostas"),
    countryFeels: "Seu país sente {mood}",
    smallCountry: "Países pequenos mostram seu continente até que {n} pessoas respondam.",
  },

  journal: {
    label: "Seus últimos 7 dias",
    none: "nada",
    onDevice: "Fica só neste aparelho",
    clear: "apagar",
  },

  hints: { tapCountry: "Toque em um país" },

  language: { menu: "Idioma", suggest: "Sugerir uma tradução melhor" },
};
