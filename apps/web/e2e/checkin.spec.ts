/**
 * The check-in moment (README §8.2.5, docs/design/phase-4-motion.md §3) in real Chrome: pick a
 * mood, the face flies to your country, a ripple spreads, the world count ticks up by one.
 */
import { expect, type Page, test } from "@playwright/test";

type L = {
  center: [number, number];
  ripple: boolean;
  gliding: boolean;
  focus: string | null;
  pin: [number, number] | null;
};
const country = (page: Page) => page.locator("#checkin").getAttribute("data-country");
const mode = (page: Page) => page.locator("#checkin").getAttribute("data-mode");
async function searchFor(page: Page, text: string, code: string) {
  await page.locator("#checkin .search input").fill(text);
  await page.locator(`#checkin .result[data-code="${code}"]`).click();
}
const layout = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: { layout(): L } }).__bench.layout());
const count = async (page: Page) =>
  Number(await page.locator("#world-count .count").getAttribute("data-value"));

/**
 * The world count at the instant the face lands (the .flight element is removed). Svelte updates
 * the counter in the same render, so this reads the landing's own number: a later aggregation run
 * (every 2 s in the demo, ~5 min in production) cannot mask a missing or doubled tick.
 */
async function countAtLanding(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    (window as unknown as { __landed: Promise<number> }).__landed = new Promise<number>(
      (resolve) => {
        let seen = false;
        const mo = new MutationObserver(() => {
          const flying = document.querySelector(".flight") !== null;
          if (flying) seen = true;
          else if (seen) {
            mo.disconnect();
            resolve(
              Number(document.querySelector("#world-count .count")?.getAttribute("data-value")),
            );
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      },
    );
  });
  return () => page.evaluate(() => (window as unknown as { __landed: Promise<number> }).__landed);
}

/** Record navigator.vibrate calls (Chrome on a desktop has the API but no motor to observe). */
async function recordVibrations(page: Page): Promise<() => Promise<unknown[]>> {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __vibrations: unknown[] }).__vibrations = calls;
    navigator.vibrate = ((pattern: unknown) => {
      calls.push(pattern);
      return true;
    }) as Navigator["vibrate"];
  });
  return () => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
}

const errors: string[] = [];
test.afterEach(() => expect(errors, "page errors").toEqual([]));
async function load(page: Page, query = "?auto=0") {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
}
const only = (name: string, names: string[]) =>
  test.skip(!names.includes(name), "behaviour, not layout");

test.describe("Nigeria (en-NG)", () => {
  test.use({ locale: "en-NG" });

  test("the country is guessed from the browser language", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    expect(await country(page)).toBe("NG");
    await expect(page.locator("#checkin .face").first()).toBeEnabled();
  });

  test("tap a mood: the face flies to Nigeria, a ripple spreads, the count ticks up once", async ({
    page,
  }, info) => {
    only(info.project.name, ["phone-390", "laptop-1440"]);
    const vibrations = await recordVibrations(page);
    await load(page);
    const before = await count(page);
    const atLanding = await countAtLanding(page);
    await page.locator('#checkin .face[data-mood="happy"]').click();
    await expect(page.locator(".flight"), "the face is in flight").toBeVisible();
    expect(await vibrations(), "no buzz until it lands").toEqual([]);
    expect(await atLanding(), "ticks up by one as it lands").toBe(before + 1);
    // One tick as it lands. 30 ms: the Pixel 6 Pro could not be felt at 12 ms (2026-11-08 review).
    expect(await vibrations(), "one buzz on landing").toEqual([30]);
    await expect(page.locator("#checkin .chip")).toContainText("You feel happy");
    await expect.poll(async () => (await layout(page)).ripple, { timeout: 4000 }).toBe(true);
    await expect(page.locator(".flight"), "landed").toHaveCount(0);
    expect(await count(page), "one more person").toBe(before + 1);
    // The camera turned Nigeria (centroid ≈ 8°E, 9.6°N) to the front.
    await expect.poll(async () => (await layout(page)).gliding).toBe(false);
    const [lon, lat] = (await layout(page)).center;
    expect(Math.abs(lon - 8) + Math.abs(lat - 9.6), "centred on Nigeria").toBeLessThan(3);
    // The next aggregation runs include the vote: the count stays at +1, not +2 or back to +0.
    await page.waitForTimeout(4500);
    expect(await count(page)).toBe(before + 1);
    await expect.poll(async () => (await layout(page)).ripple, { timeout: 5000 }).toBe(false);
  });

  test("a snapshot arriving mid-flight (already with your vote) is not counted twice", async ({
    page,
  }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    const before = await count(page);
    const atLanding = await countAtLanding(page);
    await page.locator('#checkin .face[data-mood="angry"]').click();
    await expect(page.locator(".flight")).toBeVisible();
    // The aggregator runs while the face is in the air: its snapshot already includes your vote.
    await page.evaluate(() =>
      (window as unknown as { __bench: { aggregate(): void } }).__bench.aggregate(),
    );
    expect(await atLanding()).toBe(before + 1);
  });

  test("changing your mood replaces your vote: no second count", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    const before = await count(page);
    await page.locator('#checkin .face[data-mood="calm"]').click();
    await expect(page.locator(".flight")).toHaveCount(0, { timeout: 4000 });
    await page.locator("#checkin .chip .link").click();
    const atLanding = await countAtLanding(page);
    await page.locator('#checkin .face[data-mood="sad"]').click();
    await expect(page.locator("#checkin .chip")).toContainText("You feel sad");
    expect(await atLanding(), "a changed mood does not add a person").toBe(before + 1);
    await page.waitForTimeout(2500); // an aggregation run with the replaced vote
    expect(await count(page)).toBe(before + 1);
  });

  test("the bar keeps its height, so checking in never moves the globe", async ({ page }, info) => {
    only(info.project.name, ["phone-360", "laptop-1440"]);
    await load(page);
    const bar = () => page.locator("#checkin").evaluate((e) => (e as HTMLElement).offsetHeight);
    const h = await bar();
    await page.locator('#checkin .face[data-mood="excited"]').click();
    await expect(page.locator(".flight")).toHaveCount(0, { timeout: 4000 });
    expect(await bar()).toBe(h);
  });

  test("keyboard: Tab to a face and press Enter", async ({ page }, info) => {
    only(info.project.name, ["laptop-1440"]);
    await load(page);
    const face = page.locator('#checkin .face[data-mood="stressed"]');
    await face.focus();
    await expect(face).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#checkin .chip")).toContainText("You feel stressed");
  });
});

test.describe("no country in the browser language", () => {
  test.use({ locale: "en-001" }); // "English (world)": no country to guess

  test("faces wait until you pick your country", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    expect(await country(page)).toBe("");
    await expect(page.locator("#checkin .face").first()).toBeDisabled();
    await expect(page.locator("#checkin .from")).toContainText("Where are you?");
    await page.locator("#checkin-move").click(); // "show me"
    await searchFor(page, "Kenya", "KE");
    await expect(page.locator("#checkin .face").first()).toBeEnabled();
  });
});

test.describe("reduced motion", () => {
  test.use({ locale: "en-NG", reducedMotion: "reduce" });

  test("no flight and no ripple; the count still updates", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    const vibrations = await recordVibrations(page);
    await load(page);
    const before = await count(page);
    await page.locator('#checkin .face[data-mood="happy"]').click();
    await expect(page.locator("#checkin .chip")).toContainText("You feel happy");
    expect(await count(page)).toBe(before + 1);
    await expect(page.locator(".flight")).toHaveCount(0);
    expect((await layout(page)).ripple).toBe(false);
    expect(await vibrations(), "no buzz under reduced motion (decision M4)").toEqual([]);
  });
});

test("zoomed into a continent the check-in bar steps aside", async ({ page }, info) => {
  only(info.project.name, ["phone-390", "laptop-1440"]);
  await load(page);
  await expect(page.locator("#checkin")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(10, 50),
  );
  await page.waitForTimeout(200); // let a frame apply the new rotation before reading a point
  const p = await page.evaluate(() =>
    (
      window as unknown as { __bench: { screenPoint(a: number, b: number): [number, number] } }
    ).__bench.screenPoint(10, 50),
  );
  await page.mouse.click(p[0], p[1]);
  await expect.poll(async () => (await layout(page)).focus).toBe("EU");
  await expect(page.locator("#checkin")).toBeHidden();
  await page.locator("#back").click();
  await expect(page.locator("#checkin")).toBeVisible();
});

test.describe("pick your country on the globe", () => {
  test.use({ locale: "en-NG" });

  async function aim(page: Page, lon: number, lat: number) {
    await page.evaluate(
      ([a, b]) =>
        (window as unknown as { __bench: { face(a: number, b: number): void } }).__bench.face(a, b),
      [lon, lat] as [number, number],
    );
    await page.waitForTimeout(200);
    return page.evaluate(
      ([a, b]) =>
        (
          window as unknown as {
            __bench: { screenPoint(a: number, b: number): [number, number] };
          }
        ).__bench.screenPoint(a, b),
      [lon, lat] as [number, number],
    );
  }

  test("move → tap Tokyo: the pin lands where you tapped, no drill-down", async ({
    page,
  }, info) => {
    only(info.project.name, ["phone-390", "laptop-1440"]);
    await load(page);
    await page.locator("#checkin-move").click();
    expect(await mode(page)).toBe("pick");
    const p = await aim(page, 139.7, 35.7);
    await page.mouse.click(p[0], p[1]);
    expect(await country(page)).toBe("JP");
    expect(await mode(page), "back to the faces").toBe("faces");
    const [lon, lat] = (await layout(page)).pin as [number, number];
    expect(Math.abs(lon - 139.7) + Math.abs(lat - 35.7), "pin at the tap").toBeLessThan(1);
    expect((await layout(page)).focus, "a pick is not a drill-down").toBeNull();
    // Checking in now lands on that pin.
    await page.locator('#checkin .face[data-mood="calm"]').click();
    await expect.poll(async () => (await layout(page)).gliding).toBe(false);
    const c = (await layout(page)).center;
    expect(Math.abs(c[0] - lon) + Math.abs(c[1] - lat)).toBeLessThan(0.5);
  });

  test("the globe holds still while you aim (no idle spin in pick mode)", async ({
    page,
  }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    await page.locator("#checkin-move").click();
    await expect.poll(async () => (await layout(page)).gliding).toBe(false);
    const a = (await layout(page)).center;
    await page.waitForTimeout(5500); // idle rotation would start 4 s after the last input
    expect((await layout(page)).center).toEqual(a);
  });

  test("your exact pin is remembered on this device, not just the country", async ({
    page,
  }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    await page.locator("#checkin-move").click();
    const p = await aim(page, 141.3, 43.1); // Sapporo: far from Japan's pin point (Honshu)
    await page.mouse.click(p[0], p[1]);
    const pin = (await layout(page)).pin as [number, number];
    expect(Math.abs(pin[1] - 43.1), "pinned in Hokkaido").toBeLessThan(1);
    await load(page);
    expect(await country(page)).toBe("JP");
    expect((await layout(page)).pin).toEqual(pin);
  });

  test("ocean taps keep picking; cancel keeps your country", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    await page.locator("#checkin-move").click();
    const sea = await aim(page, -30, 0); // mid-Atlantic
    await page.mouse.click(sea[0], sea[1]);
    expect(await mode(page)).toBe("pick");
    expect(await country(page)).toBe("NG");
    await page.locator("#checkin .pick .link").click(); // cancel
    expect(await mode(page)).toBe("faces");
    expect(await country(page)).toBe("NG");
  });

  test("search: accents optional, and countries too small to tap", async ({ page }, info) => {
    only(info.project.name, ["phone-390"]);
    await load(page);
    await page.locator("#checkin-move").click();
    await page.locator("#checkin .search input").fill("cote");
    await expect(page.locator('#checkin .result[data-code="CI"]')).toBeVisible();
    // The Vatican is a zero-area sliver on the map: it can only be reached by search.
    await searchFor(page, "vatican", "VA");
    expect(await country(page)).toBe("VA");
    await page.locator("#checkin-move").click();
    await page.locator("#checkin .search input").fill("zzzz");
    await expect(page.locator("#checkin .none")).toHaveText("No match");
  });

  test("keyboard: Enter on move goes straight to the search", async ({ page }, info) => {
    only(info.project.name, ["laptop-1440"]);
    await load(page);
    await page.locator("#checkin-move").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#checkin .search input")).toBeFocused();
    await page.keyboard.type("Ghana");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    expect(await country(page)).toBe("GH");
  });

  test("the bar is the same height in every mode", async ({ page }, info) => {
    only(info.project.name, ["phone-360", "phone-landscape", "laptop-1440"]);
    await load(page);
    const h = () => page.locator("#checkin").evaluate((e) => (e as HTMLElement).offsetHeight);
    const faces = await h();
    await page.locator("#checkin-move").click();
    await page.locator("#checkin .search input").fill("ken");
    expect(await h(), "pick mode with results").toBe(faces);
    await page.locator("#checkin .pick .link").click();
    await page.locator('#checkin .face[data-mood="sad"]').click();
    await expect(page.locator(".flight")).toHaveCount(0, { timeout: 4000 });
    expect(await h(), "chip").toBe(faces);
  });
});
