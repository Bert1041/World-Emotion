/**
 * Where a vote counts (README §5.6, decision L3). The connection's country is learnt from the
 * API's answer and remembered on the device; before a tap, a pin in another country says the vote
 * will count for the world only. (The after-tap path, an API answer of "world", is in the polled
 * source's tests: the demo always counts for the pin's country.)
 */
import { expect, type Page, test } from "@playwright/test";

type Bench = { ready: Promise<void> };
const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function start(page: Page, conn: string | null) {
  await page.goto("/?auto=0");
  await page.evaluate((conn) => {
    localStorage.setItem("we.pin", JSON.stringify({ code: "NG", lon: 8.6, lat: 9.1 }));
    if (conn === null) localStorage.removeItem("we.conn");
    else localStorage.setItem("we.conn", conn);
  }, conn);
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}

test("a remembered connection in another country: the bar says so before the tap", async ({
  page,
}, info) => {
  only(info.project.name);
  await start(page, "FR");
  await expect(page.locator("#checkin-world-only")).toHaveText(
    "Counts for the world: your connection is in France.",
  );
  await page.locator('#checkin .face[data-mood="calm"]').click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  // The demo's answer counts for the pin's country: no notice, and that answer is remembered.
  await expect(page.locator("#checkin-world-only")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("we.conn"))).toBe("NG");
});

test("no notice when the connection matches the pin, is unknown, or is not a country", async ({
  page,
}, info) => {
  only(info.project.name);
  for (const conn of ["NG", null, "XX"]) {
    await start(page, conn);
    await expect(page.locator("#checkin-world-only"), String(conn)).toHaveCount(0);
  }
});

test("a check-in survives a reload for as long as it counts, then is forgotten", async ({
  page,
}, info) => {
  // Reported on the real site, 2026-11-22: check in, reload, and the faces asked again, though
  // the server held the vote for 6 hours.
  only(info.project.name);
  await start(page, null);
  await page.locator('#checkin .face[data-mood="calm"]').click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await expect(page.locator("#checkin"), "still checked in after a reload").toHaveAttribute(
    "data-mode",
    "chip",
  );
  await expect(page.locator("#checkin .chip")).toContainText("You feel calm");

  // Seven hours later the server has let it go; so does the app.
  await page.evaluate(() => {
    localStorage.setItem("we.current", JSON.stringify({ mood: 1, at: Date.now() - 7 * 3_600_000 }));
  });
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "faces");
});

test("after a check-in with the keyboard, focus stays on the bar ('change')", async ({
  page,
}, info) => {
  // QA, 2026-11-22: the focused face became inert and focus fell to the page.
  only(info.project.name);
  await start(page, null);
  await page.locator('#checkin .face[data-mood="happy"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  await expect(page.locator("#checkin .chip .link").first()).toBeFocused();
});
