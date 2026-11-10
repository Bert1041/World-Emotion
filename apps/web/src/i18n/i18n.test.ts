import { describe, expect, it } from "vitest";
import { CATALOGUES, LOCALES, type Locale, makeFmt, pickLocale } from "./locale";
import type { Messages } from "./messages";

const en = CATALOGUES.en;
const others = LOCALES.filter((l) => l !== "en");

/** Every leaf of a catalogue as [path, value]; functions are sampled at n = 1 and n = 5. */
function leaves(m: Messages, fmt = makeFmt("en")): [string, unknown][] {
  const out: [string, unknown][] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "function") {
      for (const n of [1, 5])
        out.push([`${path}(${n})`, (v as (n: number, f: typeof fmt) => string)(n, fmt)]);
    } else if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    } else {
      out.push([path, v]);
    }
  };
  walk(m, "");
  return out;
}

describe("catalogues", () => {
  it.each(others)("%s has exactly English's keys, list lengths and value kinds", (l) => {
    const shape = (m: Messages) => leaves(m).map(([p, v]) => `${p}:${typeof v}`);
    expect(shape(CATALOGUES[l])).toEqual(shape(en));
  });

  it.each(others)("%s keeps every placeholder English has, and adds none", (l) => {
    const holes = (v: unknown) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const theirs = new Map(leaves(CATALOGUES[l], makeFmt(l)));
    for (const [path, v] of leaves(en))
      expect(holes(theirs.get(path)), `${l} ${path}`).toEqual(holes(v));
  });

  // Words that really are the same in a language (checked, not overlooked).
  const SAME: Readonly<Record<Exclude<Locale, "en">, readonly string[]>> = {
    fr: ["meta.reviewedOn", "pageTitle", "continents.EU"],
    "es-419": ["meta.reviewedOn", "pageTitle", "continents.AS"],
    "pt-BR": ["meta.reviewedOn", "pageTitle", "continents.OC"],
  };
  it.each(others)("%s leaves no English behind (except words that are the same)", (l) => {
    const theirs = new Map(leaves(CATALOGUES[l], makeFmt(l)));
    const same = leaves(en)
      .filter(
        ([p, v]) =>
          typeof v === "string" && theirs.get(p) === v && !p.startsWith("meta.reviewedBy"),
      )
      .map(([p]) => p);
    expect(same.sort()).toEqual([...SAME[l as Exclude<Locale, "en">]].sort());
  });

  it("French puts a non-breaking space before ? and : (and never a plain one)", () => {
    for (const [p, v] of leaves(CATALOGUES.fr, makeFmt("fr"))) {
      if (typeof v !== "string") continue;
      expect(v, p).not.toMatch(/ [?:!;]/);
      expect(v, p).not.toMatch(/[^\s ][?:!;](\s|$)/);
    }
  });
});

describe("plurals and numbers, per language", () => {
  const count = (l: Locale, n: number) => CATALOGUES[l].region.checkIns(n, makeFmt(l));
  const people = (l: Locale, n: number) =>
    CATALOGUES[l].feelingNow(n, makeFmt(l)).replace("{count}", makeFmt(l).n(n));

  it.each([
    ["en", 0, "0 check-ins"],
    ["en", 1, "1 check-in"], // was "1 check-ins" before plural rules
    ["en", 2, "2 check-ins"],
    ["en", 1000, "1,000 check-ins"],
    ["fr", 0, "0 humeur partagée"], // French singular for 0
    ["fr", 1, "1 humeur partagée"],
    ["fr", 2, "2 humeurs partagées"],
    ["fr", 1000, "1 000 humeurs partagées"], // narrow no-break space, French grouping
    ["fr", 1_000_000, "1 000 000 humeurs partagées"], // "many" in CLDR: still plural
    ["es-419", 0, "0 respuestas"],
    ["es-419", 1, "1 respuesta"],
    ["es-419", 21, "21 respuestas"],
    ["es-419", 1_000_000, "1,000,000 respuestas"], // "many" in CLDR: still plural
    ["pt-BR", 0, "0 respostas"], // CLDR says "one" for 0 in pt; Brazilian usage says plural
    ["pt-BR", 1, "1 resposta"],
    ["pt-BR", 5, "5 respostas"],
    ["pt-BR", 1000, "1.000 respostas"],
  ] as const)("%s, %i → %s", (l, n, want) => {
    expect(count(l, n)).toBe(want);
  });

  it.each([
    ["en", 1, "1 feeling something right now"],
    ["fr", 1, "1 personne ressent quelque chose"],
    ["fr", 2, "2 personnes ressentent quelque chose"],
    ["es-419", 1, "1 persona siente algo ahora mismo"],
    ["es-419", 2, "2 personas sienten algo ahora mismo"],
    ["pt-BR", 0, "0 pessoas sentindo algo agora"],
    ["pt-BR", 1, "1 pessoa sentindo algo agora"],
  ] as const)("people: %s, %i → %s", (l, n, want) => {
    expect(people(l, n)).toBe(want);
  });

  it.each([
    ["en", 42, "42%"],
    ["fr", 42, "42 %"],
    ["es-419", 42, "42%"], // Latin America: no space (Spain writes "42 %")
    ["pt-BR", 42, "42%"],
  ] as const)("percent: %s → %s", (l, n, want) => {
    expect(makeFmt(l).pct(n)).toBe(want);
  });
});

describe("pickLocale", () => {
  it.each([
    [["fr-CA"], null, null, "fr"],
    [["es-AR"], null, null, "es-419"],
    [["es-ES"], null, null, "es-419"],
    [["pt-PT"], null, null, "pt-BR"],
    [["pt"], null, null, "pt-BR"],
    [["en-NG"], null, null, "en"],
    [["de-DE", "fr-FR"], null, null, "fr"], // first one we ship
    [["de-DE", "it"], null, null, "en"], // none: English
    [["fr-FR"], "pt-BR", null, "pt-BR"], // the device's choice beats the browser
    [["fr-FR"], "pt-BR", "es", "es-419"], // ?lang= beats both
    [["fr-FR"], "xx", "zz", "fr"], // junk stored or forced values are ignored
    [[], null, null, "en"],
  ] as const)("browser %j, stored %s, forced %s → %s", (browser, stored, forced, want) => {
    expect(pickLocale(browser, stored, forced)).toBe(want);
  });
});
