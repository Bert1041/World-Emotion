/**
 * The result line (bridge R1): after a check-in the bar says who else feels it, with real numbers
 * from the snapshot (the same ones the region card shows), in the user's language.
 */
import { expect, type Page, test } from "@playwright/test";
import { SnapshotSim } from "../src/demo/snapshot-sim";

type Bench = { ready: Promise<void>; aggregate(): void };
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function load(page: Page, query = "?auto=0") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  return errors;
}
const result = (page: Page) => page.locator("#checkin-result");
const others = async (page: Page) => Number(await result(page).getAttribute("data-others"));

/** The demo's largest country (same seed as the page): far above the 50 check-ins a number needs. */
const [BIG, BIG_N] = Object.entries(new SnapshotSim(1).snapshot.countries)
  .map(([code, r]) => [code, r.n] as const)
  .sort((a, b) => b[1] - a[1])[0] as readonly [string, number];

async function pickCountry(page: Page, code: string, lang = "en") {
  const name = new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? "";
  await page.locator("#checkin-move").click();
  await page.locator("#checkin .search input").fill(name);
  await page.locator(`#checkin .result[data-code="${code}"]`).click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-country", code);
}

test("after a check-in: 'Like N others in your country', N from the snapshot, and the country's mood", async ({
  page,
}, info) => {
  only(info.project.name);
  expect(BIG_N, "fixture: the demo's largest country").toBeGreaterThan(100);
  const errors = await load(page);
  await pickCountry(page, BIG);
  await expect(result(page)).toHaveCount(0);
  await page.locator('#checkin .face[data-mood="stressed"]').click();
  // At once, not at the next snapshot (2 s in the demo, up to 5 minutes for real).
  expect(await page.evaluate(() => document.getElementById("checkin-result") !== null)).toBe(true);
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  await expect(result(page)).toHaveAttribute("data-scope", "country");
  const n = await others(page);
  expect(n).toBeGreaterThan(0);
  expect(n, "a share of the country, not the world").toBeLessThan(BIG_N + 2);
  await expect(result(page).locator(".like")).toHaveText(
    `Like ${n.toLocaleString("en-US")} ${n === 1 ? "other" : "others"} in your country`,
  );
  await expect(result(page).locator(".feels")).toContainText("Your country feels ");
  // Not a pill: the line must not inherit the search results' look.
  expect(await result(page).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");

  // Your own vote lands with the next aggregation run: at most one more, never fewer.
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
  await expect.poll(() => others(page)).toBeGreaterThanOrEqual(n);
  expect((await others(page)) - n).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("changing mood changes the number to that mood's", async ({ page }, info) => {
  only(info.project.name);
  await load(page);
  await pickCountry(page, BIG);
  // Calm is the demo world's leading mood, so its count differs from any minor mood's.
  await page.locator('#checkin .face[data-mood="calm"]').click();
  await expect(result(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
  const calm = await others(page);
  await page.locator("#checkin .chip .link").click();
  await page.locator('#checkin .face[data-mood="angry"]').click();
  await expect(page.locator("#checkin .chip")).toContainText("You feel angry");
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
  await expect.poll(() => others(page)).toBeLessThan(calm);
});

test.describe("an early world: the exact total, not a per-mood estimate", () => {
  test("4 check-ins before yours: 'One of the first 5'", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=4");
    await page.locator('#checkin .face[data-mood="calm"]').click();
    await expect(result(page)).toHaveAttribute("data-scope", "early");
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
    await expect(result(page).locator(".like")).toHaveText("One of the first 5 to check in");
    await expect(result(page).locator(".feels")).toHaveCount(0);
  });

  test("nobody else: 'The first…', never a zero", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=0");
    await page.locator('#checkin .face[data-mood="sad"]').click();
    await expect(result(page).locator(".like")).toHaveText("The first to check in right now");
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
    await expect(result(page).locator(".like")).toHaveText("The first to check in right now");
    await expect(page.locator("body")).not.toContainText(/Like 0|first 0/);
  });
});

test("in French, with French number grouping and no English", async ({ page }, info) => {
  only(info.project.name);
  await load(page, "?auto=0&lang=fr");
  await pickCountry(page, BIG, "fr");
  await page.locator("#checkin .face").nth(1).click();
  await expect(result(page).locator(".like")).toContainText(
    /Comme .* autres? personnes? dans ton pays/,
  );
  await expect(result(page).locator(".feels")).toContainText("Ton pays ressent");
  await expect(result(page)).not.toContainText(/Like|others|country/);
});

test("the bar keeps its height with the longest line (French, largest country)", async ({
  page,
}, info) => {
  test.skip(
    !["phone-360", "phone-landscape", "laptop-1440"].includes(info.project.name),
    "the narrowest phone, a phone on its side, a wide bar",
  );
  await load(page, "?auto=0&lang=fr");
  await pickCountry(page, BIG, "fr");
  const bar = page.locator("#checkin");
  const h = () => bar.evaluate((e) => (e as HTMLElement).offsetHeight);
  const before = await h();
  await page.locator('#checkin .face[data-mood="excited"]').click();
  await expect(result(page)).toHaveAttribute("data-scope", "country");
  await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 });
  expect(await h(), "chip with the result line").toBe(before);
  // And the line is fully inside the bar, not clipped or spilling over the globe.
  const [line, box] = await Promise.all([result(page).boundingBox(), bar.boundingBox()]);
  expect((line?.y ?? 0) + (line?.height ?? 0)).toBeLessThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0),
  );
  expect(line?.x ?? -1).toBeGreaterThanOrEqual(box?.x ?? 0);
});
