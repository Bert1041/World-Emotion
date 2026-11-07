/**
 * UI behaviour (src/ui/*.svelte) in real Chrome: things a layout test cannot see. Run on one
 * portrait and one landscape screen; layout.spec.ts covers every viewport.
 */
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }, info) => {
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  await page.goto("/?auto=0");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
});

async function tapEurope(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(10, 45),
  );
  await page.waitForTimeout(200);
  const p = await page.evaluate(() =>
    (
      window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
    ).__bench.screenPoint(2.5, 46.5),
  );
  await page.mouse.click(p[0], p[1]);
}

test("region bars fill from empty, then rest at their share", async ({ page }) => {
  // Sample the first bar's scaleX on every frame from the moment it exists.
  const samples = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const t0 = performance.now();
        const tick = () => {
          const fill = document.querySelector<HTMLElement>("#bars .fill");
          if (fill) {
            const m = getComputedStyle(fill).transform.match(/matrix\(([^,]+)/);
            out.push(m ? Number(m[1]) : 1);
          }
          if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  await tapEurope(page);
  const s = await samples;
  expect(s.length, "bar never appeared").toBeGreaterThan(20);
  const final = s[s.length - 1] as number;
  expect(final, "bar has a share").toBeGreaterThan(0.02);
  expect(s[0] as number, "starts empty").toBeLessThan(final * 0.2);
  expect(
    s.some((v) => v > final * 0.2 && v < final * 0.8),
    `no in-between frames, the bar jumped: ${s.slice(0, 12).map((v) => v.toFixed(2))}`,
  ).toBe(true);
});

test("a new world mood replays the headline word's entrance", async ({ page }) => {
  const before = (await page.locator("#world-mood").textContent()) ?? "";
  const other = ["happy", "calm", "excited", "stressed", "sad", "angry"].find((m) => m !== before);
  await page.locator("#dev button", { hasText: other as string }).click();
  // The demo needs a few aggregation steps (hysteresis) before the world mood flips.
  await page.waitForFunction(
    (b) => document.getElementById("world-mood")?.textContent !== b,
    before,
    {
      timeout: 20_000,
      polling: "raf",
    },
  );
  const animating = await page.evaluate(() =>
    (document.getElementById("world-mood")?.getAnimations() ?? []).some(
      (a) => (a as CSSAnimation).animationName === "swap" && a.playState === "running",
    ),
  );
  expect(animating, "word changed without its entrance animation").toBe(true);
  await expect(page.locator("h1")).toHaveAttribute("aria-live", "polite");
});

test("coming back out replays the headline entrance every time, not just once", async ({
  page,
}) => {
  const swapRunning = () =>
    page.evaluate(() =>
      (document.getElementById("world-mood")?.getAnimations() ?? []).some(
        (a) => (a as CSSAnimation).animationName === "swap" && a.playState === "running",
      ),
    );
  for (let round = 1; round <= 2; round++) {
    await tapEurope(page);
    await expect(page.locator("#back")).toBeVisible();
    await page.locator("#back").click();
    expect(await swapRunning(), `round ${round}: headline came back without its entrance`).toBe(
      true,
    );
    await page.waitForTimeout(900); // let the 600 ms entrance finish before the next round
    expect(await swapRunning(), `round ${round}: entrance never ended`).toBe(false);
  }
});

test("dev bar: auto toggle reflects state; hidden while zoomed", async ({ page }) => {
  const auto = page.locator("#dev button", { hasText: /^auto:/ });
  await expect(auto).toHaveText("auto: off");
  await auto.click();
  await expect(auto).toHaveText("auto: on");
  await auto.click();
  await expect(auto).toHaveText("auto: off");
  await tapEurope(page);
  await expect(page.locator("#dev")).toBeHidden();
  await expect(page.locator("#back")).toBeVisible();
  await page.locator("#back").click();
  await expect(page.locator("#dev")).toBeVisible();
  await expect(page.locator("#panel")).toBeHidden();
});
