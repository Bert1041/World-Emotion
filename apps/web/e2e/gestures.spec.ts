/**
 * Gestures in real Chrome (README §8.2.2): fling with friction, pinch/wheel rubber band between the
 * world and a continent. Real input events (mouse, wheel, CDP touch), not calls into the engine.
 */
import { type CDPSession, expect, type Page, test } from "@playwright/test";

type L = {
  focus: string | null;
  gliding: boolean;
  center: [number, number];
  zoom: number;
  moving: boolean;
  globe: { cx: number; cy: number; r: number };
};
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: { layout(): L } }).__bench.layout());

const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));
test.beforeEach(async ({ page }, info) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  await page.goto("/?auto=0");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  await page.evaluate(() =>
    (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(10, 45),
  );
  await page.waitForTimeout(300);
});

/** Screen point (CSS px) of a lon/lat on the near side. */
const pointOf = (page: Page, lon: number, lat: number) =>
  page.evaluate(
    ([a, b]) =>
      (
        window as unknown as {
          __bench: { screenPoint(a: number, b: number): [number, number] };
        }
      ).__bench.screenPoint(a, b),
    [lon, lat] as [number, number],
  );

/** A horizontal mouse drag at ~60 Hz; `pauseMs` waits before letting go. */
async function drag(page: Page, dx: number, pauseMs: number) {
  const L = await layout(page);
  const [x, y] = [L.globe.cx, L.globe.cy];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x + (dx * i) / 8, y);
    await page.waitForTimeout(16);
  }
  if (pauseMs > 0) await page.waitForTimeout(pauseMs);
  await page.mouse.up();
}

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

/** Mean spin speed (°/s) over about `ms`, timed by the page's own clock (not the test's). */
async function spinSpeed(page: Page, ms: number): Promise<number> {
  const read = () =>
    page.evaluate(() => ({
      lon: (window as unknown as { __bench: { layout(): L } }).__bench.layout().center[0],
      t: performance.now(),
    }));
  const a = await read();
  await page.waitForTimeout(ms);
  const b = await read();
  return Math.abs(b.lon - a.lon) / ((b.t - a.t) / 1000);
}

const lonDrift = async (page: Page, ms: number) => {
  const a = (await layout(page)).center[0];
  await page.waitForTimeout(ms);
  return Math.abs((await layout(page)).center[0] - a);
};

test("a quick swipe flings the globe on, then friction stops it", async ({ page }) => {
  const L = await layout(page);
  await pacedSwipe(page, [L.globe.cx, L.globe.cy], -150);
  expect(await lonDrift(page, 300), "kept spinning after release").toBeGreaterThan(2);
  await expect.poll(async () => (await layout(page)).moving, { timeout: 4000 }).toBe(false);
});

test("a burst of near-simultaneous moves never reads as a wild spin", async ({ page }) => {
  // Chrome aligns real moves to frames, so build the burst directly: eight moves dispatched in
  // one task land well under a millisecond apart, then release at once.
  const L = await layout(page);
  await page.evaluate(
    ([x, y]) => {
      const fx = document.getElementById("fx") as HTMLCanvasElement;
      const ev = (type: string, cx: number) =>
        fx.dispatchEvent(
          // Pointer 1 is the mouse, always active, so capture succeeds.
          new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 1, bubbles: true }),
        );
      ev("pointerdown", x);
      for (let i = 1; i <= 8; i++) ev("pointermove", x - (150 * i) / 8);
      ev("pointerup", x - 150);
    },
    [L.globe.cx, L.globe.cy] as [number, number],
  );
  const a = (await layout(page)).center[0];
  expect(Math.abs(a - L.center[0]), "the burst registered as a drag").toBeGreaterThan(20);
  // Friction only slows it, so the mean over any interval is at most the release speed.
  expect(await spinSpeed(page, 100), "spin speed after release, °/s").toBeLessThanOrEqual(721);
  await expect.poll(async () => (await layout(page)).moving, { timeout: 6000 }).toBe(false);
  expect(Math.abs((await layout(page)).center[0] - a), "total coast").toBeLessThan(250);
});

test("a gentle nudge delivered as a burst stays a gentle drift, not a capped full spin", async ({
  page,
}) => {
  const L = await layout(page);
  await page.evaluate(
    ([x, y]) => {
      const fx = document.getElementById("fx") as HTMLCanvasElement;
      const ev = (type: string, cx: number) =>
        fx.dispatchEvent(
          new PointerEvent(type, { clientX: cx, clientY: y, pointerId: 1, bubbles: true }),
        );
      ev("pointerdown", x);
      for (let i = 1; i <= 3; i++) ev("pointermove", x - 5 * i); // 15 px in all, < 1 ms
      ev("pointerup", x - 15);
    },
    [L.globe.cx, L.globe.cy] as [number, number],
  );
  const a = (await layout(page)).center[0];
  expect(Math.abs(a - L.center[0]), "the nudge registered").toBeGreaterThan(1);
  // 15 px is ~5° on this globe; spread over one frame that is ~300°/s, far under the 720 cap.
  expect(await spinSpeed(page, 100), "drift speed, °/s").toBeLessThan(450);
});

test("a swipe that pauses before letting go does not fling", async ({ page }) => {
  await drag(page, -150, 200);
  expect(await lonDrift(page, 400)).toBeLessThan(0.01);
});

test("wheel: a small turn springs back; a big one over Europe drills in; out returns", async ({
  page,
}) => {
  const [x, y] = await pointOf(page, 10, 50);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -60); // one small notch inward
  await expect.poll(async () => (await layout(page)).zoom, { timeout: 400 }).toBeGreaterThan(1.05);
  await expect.poll(async () => (await layout(page)).moving, { timeout: 3000 }).toBe(false);
  expect((await layout(page)).focus, "springs back, no drill-down").toBeNull();
  expect((await layout(page)).zoom).toBe(1);

  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await layout(page)).focus, { timeout: 3000 }).toBe("EU");

  await expect.poll(async () => (await layout(page)).gliding, { timeout: 4000 }).toBe(false);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await layout(page)).focus, { timeout: 3000 }).toBeNull();
});

/** Two-finger touch through the DevTools protocol (Chrome turns it into pointer events). */
async function pinch(cdp: CDPSession, at: [number, number], from: number, to: number) {
  const pts = (d: number) => [
    { x: at[0] - d / 2, y: at[1], id: 1 },
    { x: at[0] + d / 2, y: at[1], id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pts(from + ((to - from) * i) / 10),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("pinch: a little springs back; a wide spread over Europe drills in", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const at = await pointOf(page, 10, 50);
  await pinch(cdp, at, 100, 110);
  await expect.poll(async () => (await layout(page)).moving, { timeout: 3000 }).toBe(false);
  expect((await layout(page)).focus).toBeNull();
  expect((await layout(page)).zoom).toBe(1);

  await pinch(cdp, at, 80, 260);
  await expect.poll(async () => (await layout(page)).focus, { timeout: 3000 }).toBe("EU");
});
