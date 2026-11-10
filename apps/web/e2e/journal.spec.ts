/**
 * The on-device journal (bridge R2, decision B3): your last seven days as a strip of faces in the
 * bar, from the second day you check in. Kept in this browser only; one tap shows that and a way
 * to clear it.
 */
import { expect, type Page, test } from "@playwright/test";

type Bench = { ready: Promise<void> };
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

/** Seed the journal before the app starts: `daysAgo → mood id`, in the page's own time zone. */
async function seed(page: Page, days: Record<number, number>) {
  await page.addInitScript((d) => {
    if (sessionStorage.getItem("seeded")) return; // once: a reload must keep what the app wrote
    sessionStorage.setItem("seeded", "1");
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const entries = Object.entries(d)
      .map(([ago, mood]) => {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(ago), 12);
        return {
          day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
          mood,
          at: day.getTime(),
          country: "NG",
        };
      })
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    localStorage.setItem("we.journal", JSON.stringify(entries));
  }, days);
}
async function load(page: Page, query = "?auto=0") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  return errors;
}
const days = (page: Page) =>
  page.locator("#journal .day").evaluateAll((els) => els.map((e) => e.getAttribute("data-mood")));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("we.journal"));

test("first day: the check-in is saved, but one day is not a strip yet", async ({ page }, info) => {
  only(info.project.name);
  await load(page);
  expect(await stored(page), "nothing before a check-in").toBeNull();
  await page.locator('#checkin .face[data-mood="calm"]').click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  await expect(page.locator("#journal")).toHaveCount(0);
  const saved = JSON.parse((await stored(page)) ?? "[]") as { mood: number }[];
  expect(saved).toHaveLength(1);
  expect(saved[0]?.mood).toBe(1);
});

test("second day: seven days, oldest first, today last and marked; a change of mood replaces today", async ({
  page,
}, info) => {
  only(info.project.name);
  await seed(page, { 1: 4, 3: 0, 9: 5 }); // yesterday sad, 3 days ago happy, 9 days ago (outside)
  const errors = await load(page);
  await expect(page.locator("#journal"), "not before this session's check-in").toHaveCount(0);
  await page.locator('#checkin .face[data-mood="stressed"]').click();
  await expect(page.locator("#journal")).toBeVisible();
  expect(await days(page)).toEqual(["", "", "", "happy", "", "sad", "stressed"]);
  await expect(page.locator("#journal .day.today")).toHaveAttribute("data-mood", "stressed");
  await expect(page.locator("#journal")).toHaveAttribute(
    "aria-label",
    "Your last 7 days: no check-in, no check-in, no check-in, happy, no check-in, sad, stressed",
  );
  expect((await page.locator("#journal").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);

  await page.locator("#checkin .chip .link").first().click();
  await page.locator('#checkin .face[data-mood="excited"]').click();
  await expect(page.locator("#journal .day.today")).toHaveAttribute("data-mood", "excited");
  expect((JSON.parse((await stored(page)) ?? "[]") as unknown[]).length, "still one per day").toBe(
    4,
  );

  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await page.locator('#checkin .face[data-mood="excited"]').click();
  expect(await days(page), "kept across a reload").toEqual([
    "",
    "",
    "",
    "happy",
    "",
    "sad",
    "excited",
  ]);
  expect(errors).toEqual([]);
});

test("tapping the strip says where it is kept; 'clear' forgets everything", async ({
  page,
}, info) => {
  only(info.project.name);
  await seed(page, { 1: 2 });
  await load(page);
  await page.locator('#checkin .face[data-mood="happy"]').click();
  await expect(page.locator("#journal")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#journal").click();
  await expect(page.locator("#journal")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#journal-info")).toContainText("Kept only on this device");
  await expect(
    page.locator("#checkin-result"),
    "the info takes the result line's place",
  ).toHaveCount(0);
  await page.locator("#journal").click();
  await expect(page.locator("#journal-info")).toHaveCount(0);
  await expect(page.locator("#checkin-result")).toBeVisible();

  await page.locator("#journal").click();
  await page.locator("#journal-clear").click();
  await expect(page.locator("#journal")).toHaveCount(0);
  await expect(page.locator("#checkin-result"), "the result line is back").toBeVisible();
  expect(await stored(page), "the key is removed, not emptied").toBeNull();
});

test("the journal never leaves the device: no request carries it", async ({ page }, info) => {
  only(info.project.name);
  await seed(page, { 1: 2 });
  const bodies: string[] = [];
  page.on("request", (r) => bodies.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`));
  await load(page);
  await page.locator('#checkin .face[data-mood="happy"]').click();
  await expect(page.locator("#journal")).toBeVisible();
  expect(
    bodies.filter((b) => !b.startsWith("GET ")),
    "nothing but GETs",
  ).toEqual([]);
  expect(bodies.filter((b) => /journal|we\.journal/.test(b))).toEqual([]);
});

test("the bar keeps its height with the strip under the longest line (French)", async ({
  page,
}, info) => {
  test.skip(
    !["phone-360", "phone-landscape", "laptop-1440"].includes(info.project.name),
    "the narrowest phone, a phone on its side, a wide bar",
  );
  await seed(page, { 1: 4, 2: 0, 3: 5, 4: 1, 5: 2, 6: 3 });
  await load(page, "?auto=0&lang=fr");
  const bar = page.locator("#checkin");
  const h = () => bar.evaluate((e) => (e as HTMLElement).offsetHeight);
  const before = await h();
  await page.locator('#checkin .face[data-mood="excited"]').click();
  await expect(page.locator("#journal")).toBeVisible();
  await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 });
  expect(await h(), "chip with result line and strip").toBe(before);
  const [strip, box] = await Promise.all([
    page.locator("#journal").boundingBox(),
    bar.boundingBox(),
  ]);
  expect((strip?.y ?? 0) + (strip?.height ?? 0), "the strip is inside the bar").toBeLessThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0),
  );
  await page.locator("#journal").click();
  expect(await h(), "with the info line open").toBe(before);
});
