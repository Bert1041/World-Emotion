/**
 * prefers-reduced-motion (README §8.4) in real Chrome: no particles, no idle rotation, no glide,
 * fling or slide. Changes still happen, as jumps and cross-fades.
 */
import { expect, type Page, test } from "@playwright/test";

type L = {
  focus: string | null;
  gliding: boolean;
  center: [number, number];
  zoom: number;
  moving: boolean;
  particles: boolean;
  globe: { cx: number; cy: number };
};
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: { layout(): L } }).__bench.layout());

/**
 * A swipe paced by the page's own frames: one move per animation frame, release on the next.
 * Driving it from the test with mouse.move would put the test runner's round-trip latency
 * between the last move and the release; on a loaded CI machine that exceeds 100 ms, which the
 * app rightly reads as a pause before letting go (no fling).
 */
const pacedSwipe = (page: Page, from: [number, number], dx: number) =>
  page.evaluate(
    ([x, y, d]) =>
      new Promise<void>((done) => {
        const fx = document.getElementById("fx") as HTMLCanvasElement;
        const ev = (type: string, cx: number) =>
          fx.dispatchEvent(
            new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 1, bubbles: true }),
          );
        ev("pointerdown", x);
        let i = 0;
        const tick = () => {
          i++;
          if (i <= 8) {
            ev("pointermove", x + (d * i) / 8);
            requestAnimationFrame(tick);
          } else {
            ev("pointerup", x + d);
            done();
          }
        };
        requestAnimationFrame(tick);
      }),
    [from[0], from[1], dx] as [number, number, number],
  );

test.use({ reducedMotion: "reduce" });
const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));
test.beforeEach(async ({ page }, info) => {
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?auto=0");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  await page.evaluate(() =>
    (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(10, 45),
  );
});

test("no particles and no idle rotation", async ({ page }) => {
  const a = await layout(page);
  await page.waitForTimeout(5000); // idle rotation would start after 4 s
  const b = await layout(page);
  expect(b.particles, "particles drawn").toBe(false);
  expect(b.center).toEqual(a.center);
});

test("drill-down and back are jumps, not glides; the headline fades, not slides", async ({
  page,
}) => {
  const p = await page.evaluate(() =>
    (
      window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
    ).__bench.screenPoint(2.5, 46.5),
  );
  await page.mouse.click(p[0], p[1]);
  await page.waitForTimeout(100); // the one frame between the tap and the fit
  const z = await layout(page);
  expect(z.focus).toBe("EU");
  expect(z.gliding, "no glide").toBe(false);
  expect(z.zoom, "already at the continent's zoom").toBeGreaterThan(1.5);
  const header = await page.locator("header").evaluate((el) => getComputedStyle(el).transform);
  expect(header, "headline slid instead of fading").toBe("none");
  await page.locator("#back").click();
  await page.waitForTimeout(50);
  const w = await layout(page);
  expect([w.focus, w.gliding, w.zoom]).toEqual([null, false, 1]);
});

test("a fast swipe stops dead on release", async ({ page }) => {
  const L = await layout(page);
  await pacedSwipe(page, [L.globe.cx, L.globe.cy], -160);
  const a = (await layout(page)).center[0];
  expect(Math.abs(a - L.center[0]), "the drag itself still works").toBeGreaterThan(10);
  await page.waitForTimeout(300);
  expect((await layout(page)).center[0]).toBe(a);
});
