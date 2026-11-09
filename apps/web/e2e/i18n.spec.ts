/**
 * Internationalisation (docs/design/phase-4.5-i18n.md) in real Chrome: every screen in each
 * language shows no English UI text; the switcher changes everything at once and is remembered;
 * country names and numbers follow the chosen language, not just the browser's.
 */
import { expect, type Page, test } from "@playwright/test";
import { CATALOGUES, type Locale, makeFmt } from "../src/i18n/locale";
import type { Messages } from "../src/i18n/messages";
import { UNTIL_DONE } from "./wait";

type Bench = {
  ready: Promise<void>;
  face(lon: number, lat: number): void;
  screenPoint(lon: number, lat: number): [number, number] | null;
  layout(): { focus: string | null; gliding: boolean };
};

const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function load(page: Page, query = "?auto=0") {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}

/**
 * English UI phrases to look for: every English string, split at its placeholders, kept when the
 * other language does not use the very same word (checked in i18n.test.ts, e.g. "Europe" in French).
 */
function englishPhrases(other: Messages): RegExp[] {
  const en = CATALOGUES.en;
  const fmt = makeFmt("en");
  const out = new Set<string>();
  const walk = (a: unknown, b: unknown) => {
    if (typeof a === "function") {
      for (const n of [1, 5]) out.add((a as (n: number, f: typeof fmt) => string)(n, fmt));
    } else if (Array.isArray(a)) {
      for (const [i, x] of a.entries()) walk(x, (b as unknown[])[i]);
    } else if (a !== null && typeof a === "object") {
      for (const [k, x] of Object.entries(a)) {
        if (k !== "meta") walk(x, (b as Record<string, unknown>)[k]);
      }
    } else if (typeof a === "string" && a !== b) {
      // Braced on purpose: unbraced, this else bound to the `if` above and never ran (found by a
      // mutation: hard-coded English on screen passed).
      out.add(a);
    }
  };
  walk(en, other);
  out.delete(en.pageTitle);
  const pieces = [...out]
    .flatMap((s) => s.split(/\{\w+\}|\d[\d,]*/))
    .map((s) => s.replace(/[←·…?:]/g, "").trim())
    .filter((s) => s.length >= 3);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...new Set(pieces)].map((p) => new RegExp(`(^|[^\\p{L}])${esc(p)}($|[^\\p{L}])`, "u"));
}

/** All text a person can see or hear right now: visible text, labels, placeholders. */
const uiText = (page: Page) =>
  page.evaluate(() => {
    // innerText, not textContent: only what is rendered visible counts as "on screen".
    // biome-ignore lint/performance/useDomNodeTextContent: visibility is the point here
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll<HTMLElement>("[aria-label], [placeholder]")) {
      if (el.closest("[hidden]") || el.closest("#dev")) continue;
      parts.push(el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? "");
    }
    return parts.join("\n");
  });

async function expectNoEnglish(page: Page, phrases: RegExp[], where: string) {
  const text = await uiText(page);
  const found = phrases.filter((r) => r.test(text)).map((r) => r.source);
  expect(found, `English on screen (${where}):\n${text}`).toEqual([]);
}

async function tapContinent(page: Page, lon: number, lat: number, focus: string) {
  await page.evaluate(([a, b]) => (window as unknown as { __bench: Bench }).__bench.face(a, b), [
    lon,
    lat,
  ] as [number, number]);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const p = (await page.evaluate(
    ([a, b]) => (window as unknown as { __bench: Bench }).__bench.screenPoint(a, b),
    [lon, lat] as [number, number],
  )) as [number, number];
  await page.mouse.click(p[0], p[1]);
  await page.waitForFunction(
    (f) => {
      const l = (window as unknown as { __bench: Bench }).__bench.layout();
      return l.focus === f && !l.gliding;
    },
    focus,
    UNTIL_DONE,
  );
}

const BROWSER: Record<Exclude<Locale, "en">, string> = {
  fr: "fr-FR",
  "es-419": "es-MX",
  "pt-BR": "pt-BR",
};

for (const [l, browserLocale] of Object.entries(BROWSER) as [Exclude<Locale, "en">, string][]) {
  test.describe(`${l} from the browser (${browserLocale})`, () => {
    test.use({ locale: browserLocale });

    test("every screen is in the language: no English UI text anywhere", async ({ page }, info) => {
      only(info.project.name);
      const phrases = englishPhrases(CATALOGUES[l]);
      await load(page);
      await expect(page.locator("html")).toHaveAttribute("lang", CATALOGUES[l].meta.tag);
      await expect(page.locator("#fx")).toHaveAttribute("aria-label", CATALOGUES[l].globeLabel);
      await expectNoEnglish(page, phrases, "world view, check-in faces");

      await page.locator("#lang .current").click();
      await expectNoEnglish(page, phrases, "language menu open");
      await page.keyboard.press("Escape");

      await page.locator("#checkin .face").first().click();
      await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
      await expectNoEnglish(page, phrases, "checked in (chip)");

      await page.locator("#checkin-move").click();
      await page.locator("#checkin .search input").fill("zzzz");
      await expect(page.locator("#checkin .none")).toBeVisible();
      await expectNoEnglish(page, phrases, "pick mode, no match");
      await page.locator("#checkin .search input").fill("bra");
      await expect(page.locator("#checkin .result").first()).toBeVisible();
      await expectNoEnglish(page, phrases, "pick mode, results");
      await page.locator("#checkin .link", { hasText: CATALOGUES[l].checkin.cancel }).click();

      await tapContinent(page, 2.5, 46.5, "EU");
      await expectNoEnglish(page, phrases, "zoomed into Europe (continent card)");
      // Phones: the card opens collapsed, with a handle. Wide screens: always open, no handle.
      if ((await page.locator("#panel-handle").count()) > 0)
        await page.locator("#panel-handle").click();
      await expect(page.locator("#bars li").first()).toBeVisible();
      await expectNoEnglish(page, phrases, "continent card open (breakdown)");
    });
  });
}

test.describe("switching language", () => {
  // English browser in Germany: the guessed country's name differs between the two languages.
  test.use({ locale: "en-DE" });

  test("the switcher changes everything at once, and the choice is remembered", async ({
    page,
  }, info) => {
    only(info.project.name);
    await load(page);
    await expect(page.locator("h1")).toContainText("The world feels");
    await expect(page.locator("#checkin .where")).toHaveText("Germany");

    await page.locator("#lang .current").click();
    await page.locator('#lang-menu [data-locale="fr"]').click();
    await expect(page.locator("h1")).toContainText("Le monde ressent");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("#checkin .where"), "country names follow the switcher").toHaveText(
      "Allemagne",
    );
    // Numbers too: French groups thousands with a narrow no-break space.
    const n = Number(await page.locator("#world-count .count").getAttribute("data-value"));
    await expect(page.locator("#world-count")).toContainText(makeFmt("fr").n(n));
    await expect(page.locator("#lang .current")).toBeFocused(); // focus returns to the button

    await page.reload();
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
    await expect(page.locator("h1"), "remembered on this device").toContainText("Le monde ressent");

    await page.locator("#lang .current").click();
    await page.locator('#lang-menu [data-locale="en"]').click();
    await expect(page.locator("h1")).toContainText("The world feels");
  });

  test("Escape closes the menu and returns focus; the suggest link prefills an issue", async ({
    page,
  }, info) => {
    only(info.project.name);
    await load(page);
    await page.locator("#lang .current").click();
    await expect(page.locator("#lang-menu")).toBeVisible();
    await expect(page.locator('#lang-menu [aria-current="true"]')).toBeFocused();
    const href = await page.locator("#lang-menu .suggest").getAttribute("href");
    expect(href).toMatch(/^https:\/\/github\.com\/Bert1041\/World-Emotion\/issues\/new\?/);
    expect(new URL(href ?? "").searchParams.get("body")).toContain("Language: English (en)");
    await page.keyboard.press("Escape");
    await expect(page.locator("#lang-menu")).toHaveCount(0);
    await expect(page.locator("#lang .current")).toBeFocused();
  });

  test("?lang= forces a language for testing", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&lang=pt-BR");
    await expect(page.locator("h1")).toContainText("O mundo sente");
  });

  test("search finds countries by their name in the language or in English", async ({
    page,
  }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&lang=fr");
    await page.locator("#checkin-move").click();
    const input = page.locator("#checkin .search input");
    await input.fill("Germany");
    await expect(page.locator('#checkin .result[data-code="DE"]')).toHaveText("Allemagne");
    await input.fill("allem");
    await expect(page.locator('#checkin .result[data-code="DE"]')).toBeVisible();
  });
});
