/**
 * How the controls feel (bridge M1, M2): every button and link reacts when pressed; the faces hop
 * when you reach for one and yours sits beside "You feel …". Under reduced motion nothing moves:
 * a pressed control dims instead.
 */
import { expect, type Page, test } from "@playwright/test";
import { UNTIL_DONE } from "./wait";

type Bench = {
  ready: Promise<void>;
  face(lon: number, lat: number): void;
  screenPoint(lon: number, lat: number): [number, number] | null;
  layout(): { focus: string | null; gliding: boolean };
};
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function load(page: Page, query = "?auto=0") {
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}

/** Every enabled, visible button and link in the UI right now, by a stable description. */
const controls = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#ui button, #ui a")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          !(el as HTMLButtonElement).disabled &&
          el.closest("[inert]") === null &&
          getComputedStyle(el).visibility !== "hidden"
        );
      })
      .map((el, i) => {
        el.setAttribute("data-probe", String(i));
        return `${el.id ? `#${el.id}` : el.className || el.tagName}|${i}`;
      }),
  );

/** Press and hold each control (releasing elsewhere, so nothing is clicked) and report its style. */
async function pressAll(page: Page) {
  const out: { name: string; rest: string; down: string }[] = [];
  for (const name of await controls(page)) {
    const el = page.locator(`[data-probe="${name.split("|")[1]}"]`);
    const style = () =>
      el.evaluate((e) => {
        const s = getComputedStyle(e);
        return `${s.transform}|${s.opacity}|${s.filter}`;
      });
    const box = await el.boundingBox();
    if (!box) continue;
    const rest = await style();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200); // past the 120 ms token
    out.push({ name, rest, down: await style() });
    await page.mouse.move(2, 2); // leave before releasing: no click
    await page.mouse.up();
    await page.waitForTimeout(160);
  }
  return out;
}

async function tapContinent(page: Page, lon: number, lat: number, focus: string) {
  await page.evaluate(([a, b]) => (window as unknown as { __bench: Bench }).__bench.face(a, b), [
    lon,
    lat,
  ] as [number, number]);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const p = (await page.evaluate(
    ([a, b]) => (window as unknown as { __bench: Bench }).__bench.screenPoint(a, b),
    [lon, lat] as [number, number],
  )) as [number, number];
  await page.mouse.click(p[0], p[1]);
  await page.waitForFunction(
    (f) => {
      const l = (window as unknown as { __bench: Bench }).__bench.layout();
      return l.focus === f && !l.gliding;
    },
    focus,
    UNTIL_DONE,
  );
}

/** The screens that between them show every control the app has. */
const SCREENS: Record<string, (page: Page) => Promise<void>> = {
  "world view": async () => {},
  "language menu": async (page) => {
    await page.locator("#lang .current").click();
  },
  "checked in, journal shown": async (page) => {
    await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      localStorage.setItem("we.journal", JSON.stringify([{ day, mood: 2, at: 1, country: "NG" }]));
    });
    await page.reload();
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
    await page.locator("#checkin .face").first().click();
    await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 });
    await page.locator("#journal").click();
  },
  "picking a country, with results": async (page) => {
    await page.locator("#checkin-move").click();
    await page.locator("#checkin .search input").fill("ni");
    await expect(page.locator("#checkin .result").first()).toBeVisible();
  },
  "zoomed into a continent": async (page) => {
    await tapContinent(page, 2.5, 46.5, "EU");
  },
};

for (const [screen, go] of Object.entries(SCREENS)) {
  test(`M1: every control on "${screen}" reacts when pressed`, async ({ page }, info) => {
    only(info.project.name);
    await load(page);
    await go(page);
    const pressed = await pressAll(page);
    expect(pressed.length, "controls found").toBeGreaterThan(0);
    const dead = pressed.filter((p) => p.down === p.rest).map((p) => p.name);
    expect(dead, "controls with no press feedback").toEqual([]);
  });
}

test("M1 under reduced motion: pressed controls dim, nothing shrinks", async ({ page }, info) => {
  only(info.project.name);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  const pressed = await pressAll(page);
  expect(pressed.length).toBeGreaterThan(0);
  for (const p of pressed) {
    expect(p.down, `${p.name} reacts`).not.toBe(p.rest);
    expect(p.down.split("|")[0], `${p.name} does not move`).toBe("none");
  }
});

test("M2: your face sits beside 'You feel …' and follows a change of mood", async ({
  page,
}, info) => {
  only(info.project.name);
  await load(page);
  await expect(page.locator("#checkin .chip-face")).toHaveCount(0);
  await page.locator('#checkin .face[data-mood="sad"]').click();
  await expect(page.locator("#checkin .chip-face")).toHaveAttribute("data-mood", "sad");
  await expect(page.locator("#checkin .chip-face svg")).toBeVisible();
  // The drawing itself, not just its label: the same face as the one tapped.
  const drawn = (sel: string) => page.locator(sel).evaluate((e) => e.innerHTML);
  expect(await drawn("#checkin .chip-face svg")).toBe(
    await drawn('#checkin .face[data-mood="sad"] svg'),
  );
  await page.locator("#checkin .chip .link").first().click();
  await page.locator('#checkin .face[data-mood="happy"]').click();
  await expect(page.locator("#checkin .chip-face")).toHaveAttribute("data-mood", "happy");
  expect(await drawn("#checkin .chip-face svg")).toBe(
    await drawn('#checkin .face[data-mood="happy"] svg'),
  );
});

test("M2: a face hops when you reach for it, and not under reduced motion", async ({
  page,
}, info) => {
  only(info.project.name);
  const hops = () =>
    page
      .locator('#checkin .face[data-mood="calm"] svg')
      .evaluate((e) => e.getAnimations().map((a) => (a as CSSAnimation).animationName));
  await load(page);
  expect(await hops()).toEqual([]);
  await page.locator('#checkin .face[data-mood="calm"]').hover();
  expect(await hops()).toEqual(["hop"]);
  await expect.poll(hops, "it settles").toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(2, 2);
  await page.locator('#checkin .face[data-mood="calm"]').hover();
  expect(await hops()).toEqual([]);
});
