/**
 * Spinning never floods the globe (found 2026-11-09, in real Chrome: dragging the globe west over
 * the Atlantic, single frames filled the whole disk with one country's colour). Every painted
 * frame's mean brightness inside the globe is recorded during the same drag that showed it; a
 * flood is a jump of several levels for one or two frames, then back.
 */
import { expect, type Page, test } from "@playwright/test";

type Bench = {
  ready: Promise<void>;
  layout(): { globe: { cx: number; cy: number; r: number } };
};

/** Start recording the base canvas's mean luminance (inside the globe) after every frame. */
const record = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __lum: number[]; __bench: Bench };
    w.__lum = [];
    const base = document.getElementById("base") as HTMLCanvasElement;
    const probe = document.createElement("canvas");
    probe.width = probe.height = 48;
    const p = probe.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const tick = () => {
      const { cx, cy, r } = w.__bench.layout().globe;
      const s = base.width / base.clientWidth;
      // The square inside the globe (no sky), shrunk to 48×48.
      const half = (r / Math.SQRT2) * s;
      p.drawImage(base, cx * s - half, cy * s - half, 2 * half, 2 * half, 0, 0, 48, 48);
      const d = p.getImageData(0, 0, 48, 48).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      w.__lum.push(sum / (48 * 48));
      if (w.__lum.length < 400) requestAnimationFrame(() => setTimeout(tick, 0));
    };
    requestAnimationFrame(() => setTimeout(tick, 0));
  });

test("dragging the globe west over the Atlantic: no flooded frame", async ({ page }, info) => {
  test.skip(info.project.name !== "laptop-1440", "behaviour, not layout");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?auto=0&opt=precision0,cull,nonight"); // no night: brightness is the map alone
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await page.waitForTimeout(800);
  const g = await page.evaluate(
    () => (window as unknown as { __bench: Bench }).__bench.layout().globe,
  );
  await record(page);
  // The drag from the capture, three times over slightly different paths (more views covered).
  for (const dy of [0, 8, -8]) {
    await page.mouse.move(g.cx - 150, g.cy + dy);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) {
      await page.mouse.move(g.cx - 150 + i * 7.5, g.cy + dy - i);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const lum = await page.evaluate(() => (window as unknown as { __lum: number[] }).__lum);
  expect(lum.length).toBeGreaterThan(100);
  // A flood: a frame much brighter or darker than both neighbours (land vs ocean colour).
  const spikes = lum
    .map((v, i) => ({ i, v }))
    .filter(({ i, v }) => {
      const a = lum[i - 1];
      const b = lum[i + 1];
      return a !== undefined && b !== undefined && Math.abs(v - a) > 2 && Math.abs(v - b) > 2;
    });
  expect(spikes, `frames ${JSON.stringify(spikes.slice(0, 5))}`).toEqual([]);
  expect(errors).toEqual([]);
});
