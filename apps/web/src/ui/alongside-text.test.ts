import { describe, expect, it } from "vitest";
import { CATALOGUES, LOCALES, makeFmt } from "../i18n/locale";
import { alongsideText } from "./alongside-text";

const en = (r: Parameters<typeof alongsideText>[0]) =>
  alongsideText(r, CATALOGUES.en.checkin, makeFmt("en"));

describe("alongsideText", () => {
  it.each([
    [{ scope: "country", others: 1203, feels: 1 }, "Like 1,203 others in your country"],
    [{ scope: "country", others: 1, feels: 1 }, "Like 1 other in your country"],
    [{ scope: "world", others: 9438, feels: null }, "Like 9,438 others in the world"],
    [{ scope: "country", others: 0, feels: 1 }, "The first to feel this in your country right now"],
    [{ scope: "world", others: 0, feels: null }, "The first to feel this in the world right now"],
    [{ scope: "early", total: 5 }, "One of the first 5 to check in"],
    [{ scope: "early", total: 1 }, "The first to check in right now"],
  ] as const)("%j → %s", (r, want) => {
    expect(en(r)).toBe(want);
  });

  it.each(LOCALES)("%s: no placeholder is left unfilled and no zero is printed", (l) => {
    const cases = [
      { scope: "country", others: 0, feels: 1 },
      { scope: "country", others: 1, feels: 1 },
      { scope: "world", others: 2500, feels: null },
      { scope: "early", total: 1 },
      { scope: "early", total: 12 },
    ] as const;
    for (const r of cases) {
      const text = alongsideText(r, CATALOGUES[l].checkin, makeFmt(l));
      expect(text, `${l} ${JSON.stringify(r)}`).not.toMatch(/[{}]/);
      expect(text, `${l} ${JSON.stringify(r)}`).not.toMatch(/(^|\D)0(\D|$)/);
    }
    expect(alongsideText(cases[2], CATALOGUES[l].checkin, makeFmt(l))).toContain(
      makeFmt(l).n(2500),
    );
  });
});
