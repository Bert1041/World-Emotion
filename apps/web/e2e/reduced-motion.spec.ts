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
  // face() holds idle rotation for tests; a real input (a click on empty sky, which selects
  // nothing) releases it, so rotation would start after 4 s if reduced motion allowed it.
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  await page.mouse.click(vp.width - 4, vp.height / 2);
  expect((await layout(page)).focus, "the click hit the sky, not a country").toBeNull();
  const a = await layout(page);
  await page.waitForTimeout(5000); // idle rotation would start after 4 s
  const b = await layout(page);
  expect(b.particles, "particles drawn").toBe(false);
  expect(b.center).toEqual(a.center);
});

test("drill-down and back are jumps, not glides; the headline fades, not slides", async ({
  page,
}) => {
  // face() (beforeEach) turns the globe on the next frame: wait for two before reading a point,
  // or under load the tap lands where France was and misses (flaked 1 in 24 at 8 workers).
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const p = await page.evaluate(() =>
    (
      window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
    ).__bench.screenPoint(2.5, 46.5),
  );
  await page.mouse.click(p[0], p[1]);
  // The fit happens on the frame after the tap; wait for it by the app's own state, not a timer.
  await expect.poll(async () => (await layout(page)).focus).toBe("EU");
  // `gliding` includes the one frame between the tap and the fit; read after that frame. Before,
  // this read could land inside it under load (seen 2026-11-11 while idle work ran at start-up).
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const z = await layout(page);
  expect(z.gliding, "no glide").toBe(false);
  expect(z.zoom, "already at the continent's zoom").toBeGreaterThan(1.5);
  const header = await page.locator("header").evaluate((el) => getComputedStyle(el).transform);
  expect(header, "headline slid instead of fading").toBe("none");
  await page.locator("#back").click();
  await expect.poll(async () => (await layout(page)).focus).toBeNull();
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
