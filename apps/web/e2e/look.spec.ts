/**
 * Phase 6.5 prototype (?look=next, docs/design/phase-6.5-motion-sound.md): the parts QA found or
 * that a person would notice at once. Everything else in the suite also runs in this look with
 * VITE_LOOK=next.
 */
import { expect, type Page, test } from "@playwright/test";

type Bench = {
  ready: Promise<void>;
  screenPoint(lon: number, lat: number): [number, number] | null;
};
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");
const NEXT = "/?auto=0&step=600000&look=next";

async function open(page: Page, url = NEXT) {
  await page.goto(url);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}

/** Count AudioContexts the page makes, and read their state. */
async function spyAudio(page: Page) {
  await page.addInitScript(() => {
    const C = window.AudioContext;
    const all: AudioContext[] = [];
    (window as unknown as { __ctxs: AudioContext[] }).__ctxs = all;
    window.AudioContext = class extends C {
      constructor(...a: ConstructorParameters<typeof AudioContext>) {
        super(...a);
        all.push(this);
      }
    };
  });
}
const audio = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ctxs: AudioContext[] }).__ctxs.map((c) => c.state));

test("the music button sits beside the language; the back button stays free when zoomed", async ({
  page,
}, info) => {
  // User, 2026-11-23: "put the icon beside language, it blocks the world back button".
  test.skip(info.project.name === "ultrawide-3440", "same corner on every screen; slow to draw");
  await open(page);
  await page.mouse.click(5, 5); // end the arrival
  const corner = page.locator("#corner");
  await expect(corner.locator("#sound + #lang")).toHaveCount(1);
  const pt = await page.evaluate(() =>
    (window as unknown as { __bench: Bench }).__bench.screenPoint(20, 5),
  );
  if (pt === null) throw new Error("Africa not on screen");
  await page.mouse.click(pt[0], pt[1]);
  const back = page.locator("#back");
  await expect(back).toBeVisible();
  const b = await back.boundingBox();
  if (b === null) throw new Error("no back box");
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, {
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
  });
  expect(hit, "a tap on the back button reaches it").toBe("back");
});

test("music: nothing loads before the button; on, off and remembered", async ({ page }, info) => {
  only(info.project.name);
  await spyAudio(page);
  const chunks: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/score-")) chunks.push(r.url());
  });
  await open(page);
  await page.waitForTimeout(500);
  expect(await audio(page), "no audio before a press").toEqual([]);
  expect(chunks, "the score is not downloaded before a press").toEqual([]);
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#sound").click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => audio(page)).toEqual(["running"]);
  expect(chunks).toHaveLength(1);

  await page.locator("#sound").click();
  await expect.poll(() => audio(page), { timeout: 3000 }).toEqual(["suspended"]);

  // Remembered: on the next visit it waits for the first touch (browsers forbid autoplay).
  await page.locator("#sound").click();
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await page.waitForTimeout(500);
  expect(await audio(page), "no audio before a gesture").toEqual([]);
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(5, 5);
  await expect.poll(() => audio(page)).toEqual(["running"]);
});

test("music: fast on-off-on ends on and playing (QA 2026-11-23)", async ({ page }, info) => {
  only(info.project.name);
  await spyAudio(page);
  await open(page);
  await page.mouse.click(5, 5);
  for (let i = 0; i < 7; i++) await page.locator("#sound").click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1500); // longer than the fade-out an earlier "off" started
  expect(await audio(page)).toEqual(["running"]);
});

test("the music button is named in the page's language", async ({ page }, info) => {
  only(info.project.name);
  await open(page);
  await page.evaluate(() => localStorage.setItem("world-emotion.lang", "fr"));
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await expect(page.locator("#sound")).toHaveAttribute("aria-label", "Musique");
});

test("the arrival ends at the first touch or key, and never under reduced motion", async ({
  page,
  browser,
}, info) => {
  only(info.project.name);
  const arriving = (p: Page) => p.evaluate(() => document.body.classList.contains("arriving"));
  await open(page);
  expect(await arriving(page), "arriving after load").toBe(true);
  await page.keyboard.press("Tab");
  expect(await arriving(page)).toBe(false);
  // A key is not aimed at the globe: it lands where the swing would have ended, on your pin.
  const l = await page.evaluate(() =>
    (
      window as unknown as { __bench: { layout(): { center: number[]; pin: number[] | null } } }
    ).__bench.layout(),
  );
  expect(l.pin).not.toBeNull();
  expect(Math.abs((l.center[0] as number) - (l.pin?.[0] as number)), "facing the pin").toBeLessThan(
    1,
  );

  const ctx = await browser.newContext({
    reducedMotion: "reduce",
    viewport: info.project.use.viewport ?? null,
  });
  const p = await ctx.newPage();
  await p.goto(`${info.project.use.baseURL ?? ""}${NEXT}`);
  await p.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  expect(await arriving(p)).toBe(false);
  await expect(p.locator("h1")).toHaveCSS("opacity", "1");
  await ctx.close();
});
