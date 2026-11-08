/**
 * Phone peek card (decided 2026-11-07, docs/design/phase-4-motion.md §2) in real Chrome:
 * a bottom sheet that opens collapsed and expands by the handle or a swipe; the map is re-fitted
 * to the card's visible part, and in both states the continent stays clear of it.
 */
import { expect, type Page, test } from "@playwright/test";
import { type Rect, rectsOverlap } from "../src/engine/layout";

type L = { focus: string | null; gliding: boolean; focusBox: Rect | null };
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: { layout(): L } }).__bench.layout());

const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?auto=0");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
});

async function open(page: Page, lon: number, lat: number, continent: string) {
  await page.evaluate(
    ([a, b]) =>
      (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(a, b),
    [lon, lat] as [number, number],
  );
  await page.waitForTimeout(200);
  const p = await page.evaluate(
    ([a, b]) =>
      (
        window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
      ).__bench.screenPoint(a, b),
    [lon, lat] as [number, number],
  );
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await layout(page)).focus).toBe(continent);
  await settled(page);
}

/**
 * Card spring and map re-fit both at rest, by the app's own signals (data-moving, gliding), not by
 * "two reads look the same": under load frames starve and a moving card can read unchanged.
 */
async function settled(page: Page) {
  await page.waitForFunction(
    () => {
      const card = document.getElementById("panel");
      const l = (window as unknown as { __bench: { layout(): L } }).__bench.layout();
      return card?.dataset.moving === "false" && !l.gliding;
    },
    null,
    { timeout: 10_000 },
  );
}

/** What the eye sees of the card: its box clipped to the screen. */
async function visibleCard(page: Page): Promise<Rect> {
  const b = (await page.locator("#panel").boundingBox()) as NonNullable<
    Awaited<ReturnType<ReturnType<Page["locator"]>["boundingBox"]>>
  >;
  const vh = page.viewportSize()?.height ?? 0;
  return { x: b.x, y: b.y, w: b.width, h: Math.min(b.y + b.height, vh) - b.y };
}

async function expectClear(page: Page) {
  const box = (await layout(page)).focusBox as Rect;
  const card = await visibleCard(page);
  expect(
    rectsOverlap(box, card),
    `card ${JSON.stringify(card)} covers ${JSON.stringify(box)}`,
  ).toBe(false);
}

const barsOpacity = (page: Page) =>
  page.locator("#bars").evaluate((el) => Number(getComputedStyle(el).opacity));

/**
 * A vertical swipe, paced by the page's frames (see gestures.spec.ts). Starts on the card body by
 * default, or on `from` (the handle: the strip a thumb grabs first, found dead on the Pixel).
 */
const swipeCard = (page: Page, dy: number, from = "#panel") =>
  page.evaluate(
    ([d, sel]) =>
      new Promise<void>((done) => {
        const el = document.querySelector(sel) as HTMLElement;
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = sel === "#panel" ? r.y + 40 : r.y + r.height / 2;
        const ev = (type: string, cy: number) =>
          el.dispatchEvent(
            new PointerEvent(type, { clientX: x, clientY: cy, pointerId: 1, bubbles: true }),
          );
        ev("pointerdown", y);
        let i = 0;
        const tick = () => {
          i++;
          if (i <= 10) {
            ev("pointermove", y + (d * i) / 10);
            requestAnimationFrame(tick);
          } else {
            ev("pointerup", y + d);
            done();
          }
        };
        requestAnimationFrame(tick);
      }),
    [dy, from] as const,
  );

test.describe("portrait (bottom sheet)", () => {
  test("opens collapsed; the handle expands and collapses; clear of the map both ways", async ({
    page,
  }, info) => {
    test.skip(!["phone-360", "phone-390", "tablet-portrait"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    const handle = page.locator("#panel-handle");
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(await barsOpacity(page), "bars hidden when collapsed").toBe(0);
    await expectClear(page);
    const collapsedTop = (await visibleCard(page)).y;
    const collapsedMap = (await layout(page)).focusBox as Rect;

    await handle.click();
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    expect(await barsOpacity(page)).toBe(1);
    expect((await visibleCard(page)).y, "card rose").toBeLessThan(collapsedTop - 40);
    await expectClear(page);
    // The map is fitted to the card's visible part: collapsed, it sits lower (uses the room).
    const openMap = (await layout(page)).focusBox as Rect;
    expect(
      collapsedMap.y + collapsedMap.h / 2,
      "map ignores the room the peek frees",
    ).toBeGreaterThan(openMap.y + openMap.h / 2 + 20);

    await handle.click();
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(Math.abs((await visibleCard(page)).y - collapsedTop)).toBeLessThan(1);
    await expectClear(page);
  });

  test("swipe up opens, swipe down closes; a small drag springs back", async ({ page }, info) => {
    test.skip(!["phone-360", "phone-390", "tablet-portrait"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    const handle = page.locator("#panel-handle");
    await swipeCard(page, -25); // small and slow: back to collapsed
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await swipeCard(page, -200);
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await expectClear(page);
    await swipeCard(page, 200);
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await expectClear(page);
  });

  test("the handle drags like the card; a tap and the keyboard still toggle", async ({
    page,
  }, info) => {
    test.skip(!["phone-360", "phone-390", "tablet-portrait"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    const handle = page.locator("#panel-handle");
    await swipeCard(page, -200, "#panel-handle");
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await swipeCard(page, 200, "#panel-handle");
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await handle.click(); // one tap toggles exactly once
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await handle.focus();
    await page.keyboard.press("Enter");
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await settled(page);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
  });

  test("a different region opens collapsed again", async ({ page }, info) => {
    test.skip(!["phone-360", "phone-390", "tablet-portrait"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    await page.locator("#panel-handle").click();
    await settled(page);
    await page.locator("#back").click();
    await expect.poll(async () => (await layout(page)).focus).toBeNull();
    await open(page, 22, 6, "AF");
    await expect(page.locator("#panel-handle")).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("landscape (side card)", () => {
  test("no peek: no handle, breakdown always shown", async ({ page }, info) => {
    test.skip(!["laptop-1440", "phone-landscape"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    await expect(page.locator("#panel-handle")).toHaveCount(0);
    expect(await barsOpacity(page)).toBe(1);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the card jumps between states, no slide", async ({ page }, info) => {
    test.skip(!["phone-390"].includes(info.project.name));
    await open(page, 10, 50, "EU");
    // Record the card's translate on every frame after the tap: only the two end values.
    const seen = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const out = new Set<string>();
          const el = document.getElementById("panel") as HTMLElement;
          const t0 = performance.now();
          const tick = () => {
            out.add(getComputedStyle(el).translate);
            if (performance.now() - t0 < 800) requestAnimationFrame(tick);
            else resolve([...out]);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.locator("#panel-handle").click();
    expect((await seen).length, "intermediate positions = a slide").toBeLessThanOrEqual(2);
  });
});
