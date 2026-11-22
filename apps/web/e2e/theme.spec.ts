/**
 * The Earth follows the region in view (bridge T1, decision B1): the world view shows the world's
 * Earth; zoomed into a continent, that continent's. The demo's continents each lean their own way
 * (Europe stressed, South America angry), while the world is calm.
 */
import { expect, type Page, test } from "@playwright/test";
import { UNTIL_DONE } from "./wait";

type Bench = {
  ready: Promise<void>;
  face(lon: number, lat: number): void;
  screenPoint(lon: number, lat: number): [number, number] | null;
  layout(): { focus: string | null; gliding: boolean; theme: string; worldMood: string };
};
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.layout());

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

test("zooming changes the Earth to the continent's; going back restores the world's", async ({
  page,
}, info) => {
  only(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?auto=0");
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  expect(await layout(page)).toMatchObject({ theme: "calm", worldMood: "calm" });
  const accent = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent"));
  const calmAccent = await accent();

  await tapContinent(page, 2.5, 46.5, "EU");
  expect(await layout(page), "Europe is stressed in the demo").toMatchObject({
    theme: "stressed",
    worldMood: "calm",
  });
  // The cross-fade really runs: the accent colour leaves the calm Earth's.
  await expect.poll(accent, { timeout: 6000 }).not.toBe(calmAccent);

  await page.locator("#back").click();
  // At once, not at the next snapshot.
  expect((await layout(page)).theme, "back in the world view").toBe("calm");
  await expect.poll(accent, { timeout: 6000 }).toBe(calmAccent);

  await tapContinent(page, -58, -15, "SA");
  expect((await layout(page)).theme, "South America is angry in the demo").toBe("angry");
  expect(errors).toEqual([]);
});
