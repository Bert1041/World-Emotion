import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import { describe, expect, it } from "vitest";
import { guessCountry } from "./country-guess";

describe("guessCountry (decision M2)", () => {
  it.each([
    [["en-NG"], "NG"],
    [["pt-BR", "en"], "BR"],
    [["fr-CA"], "CA"],
    [["en"], "US"], // likely region of a bare language
    [["ja"], "JP"],
    [["es-419", "es-MX"], "MX"], // 419 (Latin America) is not a country: next preference
    [["zz-ZZ", "de-DE"], "DE"],
    [["not a tag", "it-IT"], "IT"],
  ])("%j → %s", (langs, want) => {
    expect(guessCountry(langs, COUNTRY_TO_CONTINENT)).toBe(want);
  });

  it("returns null when nothing maps to a drawable country", () => {
    expect(guessCountry([], COUNTRY_TO_CONTINENT)).toBeNull();
    expect(guessCountry(["en-001"], COUNTRY_TO_CONTINENT)).toBeNull();
    expect(guessCountry(["de-DE"], new Set(["FR"]))).toBeNull();
  });
});
