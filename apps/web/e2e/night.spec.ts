/**
 * Day/night band (README §8.2.7, decision M3) in real Chrome. The page clock is fixed at the March
 * 2026 equinox, 12:00 UTC: the sun is over the Gulf of Guinea and night covers the Pacific. The
 * ocean is one flat fill, so an ocean pixel on the night side and one on the day side can be
 * compared within the same frame, whatever the mood theme is.
 */

import { expect, type Page, test } from "@playwright/test";
import { subsolarPoint } from "@world-emotion/motion";
import { NIGHT_STEP_ALPHA, NIGHT_STEPS } from "../src/engine/night";

const EQUINOX_NOON = Date.UTC(2026, 2, 20, 12);
const DAY_OCEAN: [number, number] = [-45, -40]; // South Atlantic, ~60° from the sun
const NIGHT_OCEAN: [number, number] = [-130, -20]; // South Pacific, deep night

type L = { moving: boolean; easing: boolean; gliding: boolean; sun: [number, number] | null };
type Bench = {
  ready: Promise<void>;
  layout(): L;
  face(lon: number, lat: number): void;
  screenPoint(lon: number, lat: number): [number, number] | null;
};

const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));

async function load(page: Page, query: string) {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.setFixedTime(EQUINOX_NOON); // Date only; timers and frames run normally
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  // Face the terminator over the eastern Pacific: day to the left, night to the right.
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.face(-90, 0));
  await page.waitForFunction(() => {
    const l = (window as unknown as { __bench: Bench }).__bench.layout();
    return !l.moving && !l.easing && !l.gliding;
  });
  // Two frames: the settle frame draws the detailed map.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/** Mean luminance (0–255) of a 5×5 patch of the base canvas at each lon/lat, read in one task. */
const luminance = (page: Page, points: [number, number][]) =>
  page.evaluate((pts) => {
    const b = (window as unknown as { __bench: Bench }).__bench;
    const canvas = document.getElementById("base") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    const scale = canvas.width / canvas.clientWidth;
    return pts.map(([lon, lat]) => {
      const p = b.screenPoint(lon, lat);
      if (p === null) return Number.NaN;
      const d = ctx.getImageData(
        Math.round(p[0] * scale) - 2,
        Math.round(p[1] * scale) - 2,
        5,
        5,
      ).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      return sum / 25;
    });
  }, points);

const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

test("night falls on the side away from the sun, and only there", async ({ page }, info) => {
  only(info.project.name);
  await load(page, "?auto=0");
  const sun = (
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.layout())
  ).sun as [number, number];
  const expected = subsolarPoint(EQUINOX_NOON);
  expect(sun[0], "drawn for the page's clock").toBeCloseTo(expected[0], 9);
  expect(sun[1]).toBeCloseTo(expected[1], 9);

  const [day, night] = await luminance(page, [DAY_OCEAN, NIGHT_OCEAN]);
  // Full night is every step stacked: about 1 - 0.91⁴ ≈ 31% darker (the shade is near-black).
  const full = 1 - (1 - NIGHT_STEP_ALPHA) ** NIGHT_STEPS.length;
  expect(night as number, "night ocean darker by the full shade").toBeLessThan(
    (day as number) * (1 - full + 0.05),
  );
  expect(night as number, "but not black: the map stays legible").toBeGreaterThan(
    (day as number) * (1 - full - 0.05),
  );
});

test("without the band, both sides are the same ocean (the control)", async ({ page }, info) => {
  only(info.project.name);
  await load(page, "?auto=0&opt=precision0,cull,nonight");
  expect(
    (await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.layout())).sun,
  ).toBeNull();
  const [day, night] = await luminance(page, [DAY_OCEAN, NIGHT_OCEAN]);
  expect(Math.abs((day as number) - (night as number))).toBeLessThan(1);
});
