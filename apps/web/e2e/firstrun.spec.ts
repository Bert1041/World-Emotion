/**
 * The first run on a device (bridge J2, decision B2): the bar leads with your guessed country and
 * a way to correct it, and the globe opens facing your pin, so a wrong guess is seen before the tap.
 * After the first check-in the place row returns to its usual spot, on this device for good.
 */
import { expect, type Page, test } from "@playwright/test";

type Bench = {
  ready: Promise<void>;
  layout(): { center: [number, number]; pin: [number, number] | null; gliding: boolean };
  screenPoint(lon: number, lat: number): [number, number] | null;
};
const only = (name: string) =>
  test.skip(
    !["phone-360", "phone-390", "phone-landscape", "laptop-1440"].includes(name),
    "three bar layouts",
  );

async function load(page: Page, query = "?auto=0") {
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}
const top = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())?.y ?? -1;

test.describe("Nigeria (en-NG)", () => {
  test.use({ locale: "en-NG" });

  test("while the map loads, the bar already has its first-run layout; nothing in it acts, and nothing moves when ready", async ({
    page,
  }, info) => {
    // The Pixel recording of 2026-11-17 showed "Where are you?" under the faces while loading,
    // then "Your country: Nigeria" jumping above them when the globe was ready.
    only(info.project.name);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/world-50m\.topo/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/?auto=0");
    await page.waitForFunction(() => "__bench" in window);
    await expect(page.locator("header")).toHaveAttribute("data-status", "loading");

    const bar = page.locator("#checkin");
    await expect(bar).toHaveAttribute("data-first", "true");
    await expect(page.locator("#checkin .where")).toHaveText("Nigeria");
    await expect(page.locator("#checkin-move")).toHaveText("not you?");
    await expect(page.locator("#checkin-move"), "no pick before the map").toBeDisabled();
    for (const face of await page.locator("#checkin .face").all())
      await expect(face).toBeDisabled();
    const boxes = async () => ({
      from: await top(page, "#checkin .from"),
      faces: await top(page, "#checkin .faces"),
      height: await bar.evaluate((e) => (e as HTMLElement).offsetHeight),
    });
    const loading = await boxes();

    release();
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
    await expect(page.locator("header")).toHaveAttribute("data-status", "ready");
    await expect(page.locator("#checkin-move")).toBeEnabled();
    await expect(page.locator("#checkin .face").first()).toBeEnabled();
    expect(await boxes(), "same place row, faces and height as while loading").toEqual(loading);
  });

  test("first visit: the globe faces your pin, and it is on screen", async ({ page }, info) => {
    only(info.project.name);
    await load(page);
    // The new look (Phase 6.5) swings the globe in for 2.2 s; facing or sampling it before then
    // measures the swing. Today's look has no glide here, so this returns at once.
    await page.waitForFunction(
      () => !(window as unknown as { __bench: Bench }).__bench.layout().gliding,
    );
    const l = await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.layout());
    expect(l.pin, "a pin from the guess").not.toBeNull();
    const [lon, lat] = l.pin as [number, number];
    expect(Math.abs(l.center[0] - lon), "longitude").toBeLessThan(1);
    expect(Math.abs(l.center[1] - lat), "latitude").toBeLessThan(1);
    const at = await page.evaluate(
      ([a, b]) => (window as unknown as { __bench: Bench }).__bench.screenPoint(a, b),
      [lon, lat] as [number, number],
    );
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    expect(at?.[0] ?? -1).toBeGreaterThan(0);
    expect(at?.[0] ?? 1e9).toBeLessThan(vp.width);
    expect(at?.[1] ?? -1).toBeGreaterThan(0);
    expect(at?.[1] ?? 1e9).toBeLessThan(vp.height);
  });

  test("first visit: 'Your country: Nigeria · not you?' leads; after a check-in it is 'move', for good", async ({
    page,
  }, info) => {
    only(info.project.name);
    const stacked = info.project.name === "phone-390"; // the place row is above/below the faces
    await load(page);
    const bar = page.locator("#checkin");
    await expect(bar).toHaveAttribute("data-first", "true");
    // A phone on its side has a 12.5rem bar: the label is dropped there, the link stays.
    if (info.project.name === "phone-landscape")
      await expect(page.locator("#checkin .from .label")).toBeHidden();
    else await expect(page.locator("#checkin .from .label")).toHaveText("Your country:");
    await expect(page.locator("#checkin .where")).toHaveText("Nigeria");
    await expect(page.locator("#checkin-move")).toHaveText("not you?");
    if (stacked)
      expect(await top(page, "#checkin .from")).toBeLessThan(await top(page, "#checkin .faces"));
    const height = await bar.evaluate((e) => (e as HTMLElement).offsetHeight);

    // "not you?" opens the picker, like "move".
    await page.locator("#checkin-move").click();
    await expect(bar).toHaveAttribute("data-mode", "pick");
    await page.locator("#checkin .pick .link").click();
    await expect(bar).toHaveAttribute("data-first", "true");

    await page.locator("#checkin .face").first().click();
    await expect(bar).toHaveAttribute("data-first", "false");
    await expect(page.locator("#checkin .from .label")).toHaveCount(0);
    await expect(page.locator("#checkin-move")).toHaveText("move");
    if (stacked)
      expect(await top(page, "#checkin .from")).toBeGreaterThan(await top(page, "#checkin .stack"));
    await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 });
    expect(await bar.evaluate((e) => (e as HTMLElement).offsetHeight), "same height").toBe(height);

    await page.reload();
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
    await expect(bar, "second visit on this device").toHaveAttribute("data-first", "false");
    await expect(page.locator("#checkin-move")).toHaveText("move");
  });
});

test.describe("no country in the browser language", () => {
  test.use({ locale: "eo" });
  test("no guess: no 'Your country' label; the bar asks where you are, as before", async ({
    page,
  }, info) => {
    only(info.project.name);
    await load(page);
    await expect(page.locator("#checkin")).toHaveAttribute("data-first", "false");
    await expect(page.locator("#checkin .from .label")).toHaveCount(0);
    await expect(page.locator("#checkin .where")).toHaveText("Where are you?");
  });
});

test("in French the label and link are translated", async ({ page }, info) => {
  only(info.project.name);
  await load(page, "?auto=0&lang=fr");
  await expect(page.locator("#checkin .from .label")).toHaveText("Ton pays :");
  await expect(page.locator("#checkin-move")).toHaveText("ce n’est pas ça ?");
});
