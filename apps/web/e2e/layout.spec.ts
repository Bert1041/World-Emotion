/**
 * Layout rule (docs/design/phase-3b-look-and-feel.md): text never sits on the Earth.
 * Checked geometrically in real Chrome at every viewport in playwright.config.ts.
 */
import { expect, type Page, test } from "@playwright/test";
import { circleHitsRect, type Rect, rectsOverlap } from "../src/engine/layout";

type Layout = {
  globe: { cx: number; cy: number; r: number; halo: number };
  focus: string | null;
  focusBox: Rect | null;
  gliding: boolean;
  worldMood: string;
};
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: { layout(): Layout } }).__bench.layout());

/** Every visible piece of UI that contains text or controls. */
async function uiBoxes(page: Page): Promise<{ name: string; box: Rect }[]> {
  const out: { name: string; box: Rect }[] = [];
  for (const sel of ["header", "#back", "#panel", "#dev"]) {
    const el = page.locator(sel);
    if (!(await el.isVisible())) continue;
    const b = await el.boundingBox();
    if (b && b.width > 0 && b.height > 0)
      out.push({ name: sel, box: { x: b.x, y: b.y, w: b.width, h: b.height } });
  }
  return out;
}

async function settled(page: Page, focus: string | null) {
  await page.waitForFunction(
    (f) => {
      const l = (window as unknown as { __bench: { layout(): Layout } }).__bench.layout();
      return l.focus === f && !l.gliding;
    },
    focus,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400); // CSS transitions (card slide, header fade)
  await stable(page);
}

/**
 * Wait until the layout has stopped moving: two reads 250 ms apart agree within half a pixel.
 * Late font loads (slower CI machines, other platforms' fonts) resize the headline, and the globe
 * then eases to its new place; asserting mid-ease would test a transition, not the layout.
 */
async function stable(page: Page) {
  let prev = await layout(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const next = await layout(page);
    const d =
      Math.abs(next.globe.cx - prev.globe.cx) +
      Math.abs(next.globe.cy - prev.globe.cy) +
      Math.abs(next.globe.r - prev.globe.r);
    if (d < 0.5 && !next.gliding) return;
    prev = next;
  }
  throw new Error("layout never settled");
}

async function expectWorldClear(page: Page) {
  await stable(page);
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const L = await layout(page);
  const halo = { cx: L.globe.cx, cy: L.globe.cy, r: L.globe.r * L.globe.halo };
  for (const { name, box } of await uiBoxes(page)) {
    expect(
      circleHitsRect(halo, box),
      `${name} ${JSON.stringify(box)} overlaps the globe ${JSON.stringify(halo)}`,
    ).toBe(false);
  }
  expect(halo.cx - halo.r, "globe off the left edge").toBeGreaterThanOrEqual(0);
  expect(halo.cy - halo.r, "globe off the top edge").toBeGreaterThanOrEqual(0);
  expect(halo.cx + halo.r, "globe off the right edge").toBeLessThanOrEqual(vp.width);
  expect(halo.cy + halo.r, "globe off the bottom edge").toBeLessThanOrEqual(vp.height);
  expect(L.globe.r, "globe too small to read").toBeGreaterThan(Math.min(vp.width, vp.height) * 0.2);
}

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?auto=0");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  await page.waitForTimeout(400);
});
test.afterEach(() => expect(errors, "page errors").toEqual([]));

test("world view: no text on the Earth", async ({ page }, info) => {
  await expectWorldClear(page);
  await page.screenshot({ path: info.outputPath("world.png") });
});

/** A point inside each continent to tap, and where to face first so it is on the near side. */
const TAPS: Record<string, { face: [number, number]; tap: [number, number] }> = {
  AF: { face: [20, 5], tap: [22, 6] },
  AN: { face: [0, -70], tap: [10, -78] },
  AS: { face: [100, 35], tap: [100, 35] },
  EU: { face: [10, 45], tap: [2.5, 46.5] },
  NA: { face: [-100, 40], tap: [-100, 40] },
  OC: { face: [134, -25], tap: [134, -25] },
  SA: { face: [-55, -10], tap: [-55, -10] },
};

test("a tap never reports arrival before the glide has started", async ({ page }) => {
  await page.evaluate(() => {
    const b = (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench;
    b.face(10, 45);
  });
  await page.waitForTimeout(200);
  const p = await page.evaluate(() =>
    (
      window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
    ).__bench.screenPoint(2.5, 46.5),
  );
  // Dispatch the tap and read the layout in the same task, before any animation frame runs.
  const l = await page.evaluate(([x, y]) => {
    const fx = document.getElementById("fx") as HTMLCanvasElement;
    const o = { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true };
    fx.dispatchEvent(new PointerEvent("pointerdown", o));
    fx.dispatchEvent(new PointerEvent("pointerup", o));
    return (window as unknown as { __bench: { layout(): Layout } }).__bench.layout();
  }, p);
  expect(l.focus, "tap selected the continent").toBe("EU");
  expect(l.gliding, "focused but reported as arrived before gliding").toBe(true);
});

for (const [continent, { face, tap }] of Object.entries(TAPS)) {
  test(`zoomed into ${continent}: card and controls clear of the continent, then back`, async ({
    page,
  }, info) => {
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    await page.evaluate(
      ([lon, lat]) =>
        (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(
          lon,
          lat,
        ),
      face,
    );
    await page.waitForTimeout(200);
    const p = await page.evaluate(
      ([lon, lat]) =>
        (
          window as unknown as {
            __bench: { screenPoint(a: number, b: number): [number, number] | null };
          }
        ).__bench.screenPoint(lon, lat),
      tap,
    );
    expect(p, "tap point must be visible").not.toBeNull();
    await page.mouse.click((p as [number, number])[0], (p as [number, number])[1]);
    await settled(page, continent);

    const L = await layout(page);
    const box = L.focusBox as Rect;
    expect(box, "focus box").not.toBeNull();
    for (const { name, box: ui } of await uiBoxes(page)) {
      expect(
        rectsOverlap(box, ui),
        `${name} ${JSON.stringify(ui)} covers ${continent} ${JSON.stringify(box)}`,
      ).toBe(false);
    }
    expect(box.x, "continent off the left").toBeGreaterThanOrEqual(-1);
    expect(box.y, "continent off the top").toBeGreaterThanOrEqual(-1);
    expect(box.x + box.w, "continent off the right").toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.h, "continent off the bottom").toBeLessThanOrEqual(vp.height + 1);
    // Playwright counts opacity:0 as visible, so check what the eye sees: off-screen or transparent.
    const headerGone = await page.locator("header").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom <= 0 || Number(getComputedStyle(el).opacity) < 0.05;
    });
    expect(headerGone, "world headline still on screen while zoomed").toBe(true);
    await page.screenshot({ path: info.outputPath(`zoom-${continent}.png`) });

    await page.locator("#back").click();
    await settled(page, null);
    await expect(page.locator("#panel")).toBeHidden();
    const after = await layout(page);
    await expect(page.locator("#world-mood")).toHaveText(after.worldMood);
    await expectWorldClear(page);
  });
}
