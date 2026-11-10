/**
 * Small fixes from the audit (bridge U3, U6, SC): text links have a real hit area; the first zoom
 * says countries are tappable, once per device; a country below the privacy floor says so in the
 * bar before you check in, not after.
 */
import { expect, type Page, test } from "@playwright/test";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";
import { UNTIL_DONE } from "./wait";

type Bench = {
  ready: Promise<void>;
  face(lon: number, lat: number): void;
  screenPoint(lon: number, lat: number): [number, number] | null;
  layout(): { focus: string | null; gliding: boolean };
};

const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function load(page: Page, query = "?auto=0") {
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
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

test("U3: 'move' and 'change' are small words with hit areas at least 24 px tall", async ({
  page,
}, info) => {
  only(info.project.name);
  await load(page);
  const move = await page.locator("#checkin-move").boundingBox();
  expect(move?.height ?? 0).toBeGreaterThanOrEqual(24);
  await page.locator("#checkin .face").first().click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  const change = await page.locator("#checkin .chip .link").boundingBox();
  expect(change?.height ?? 0).toBeGreaterThanOrEqual(24);
});

/** Records whether #hint ever appears from now on: the hint lives 4 s, so a late look could miss it. */
const watchHint = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __hintSeen: boolean };
    w.__hintSeen = document.getElementById("hint") !== null;
    new MutationObserver(() => {
      if (document.getElementById("hint") !== null) w.__hintSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
const hintSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hintSeen: boolean }).__hintSeen);

test("U6: the first zoom on a device says 'Tap a country', the second does not", async ({
  page,
}, info) => {
  only(info.project.name);
  await load(page);
  await watchHint(page);
  await tapContinent(page, 2.5, 46.5, "EU");
  await expect.poll(() => hintSeen(page), "first zoom").toBe(true);
  await expect(page.locator("#hint")).toHaveText("Tap a country");
  await page.locator("#back").click();
  await expect(page.locator("#hint")).toHaveCount(0);

  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await watchHint(page);
  await tapContinent(page, 2.5, 46.5, "EU");
  await page.waitForTimeout(300);
  expect(await hintSeen(page), "second zoom, same device").toBe(false);
});

test.describe("SC: a country below the privacy floor says so in the bar", () => {
  const [first] = COUNTRY_TO_CONTINENT.keys();
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(first as string) ?? "";

  async function pick(page: Page) {
    await page.locator("#checkin-move").click();
    await page.locator("#checkin .search input").fill(name.slice(0, 6));
    await page.locator(`#checkin .result[data-code="${first}"]`).click();
    await expect(page.locator("#checkin")).toHaveAttribute("data-country", first as string);
  }

  test("published at 5 check-ins: no notice", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=5");
    await pick(page);
    await expect(page.locator("#checkin .small-country")).toHaveCount(0);
  });

  test("below the floor at 4: the notice, with the floor in it", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=4");
    await pick(page);
    await expect(page.locator("#checkin .small-country")).toHaveText(
      "Small countries show their continent until 5 people check in.",
    );
  });
});
