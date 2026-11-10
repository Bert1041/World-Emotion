/**
 * Start-up states (bridge E4) and input before the map exists (E8). The e2e server serves the
 * production build, so the detailed map is `/assets/world-50m.topo-<hash>.js`, a lazy chunk the
 * tests can delay or refuse.
 */
import { expect, type Page, test } from "@playwright/test";

const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");
const MAP = /world-50m\.topo/;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0] ?? ""));
  return errors;
}

test("while the map loads: a loading line and disc, no count, and taps do nothing bad", async ({
  page,
}, info) => {
  only(info.project.name);
  const errors = watchErrors(page);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(MAP, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?auto=0");
  await page.waitForFunction(() => "__bench" in window);

  await expect(page.locator("header")).toHaveAttribute("data-status", "loading");
  await expect(page.locator("h1")).toHaveText("Loading the globe…");
  await expect(page.locator("#loading-disc")).toBeVisible();
  await expect(page.locator("#world-count")).toBeHidden();
  await expect(page.locator("#checkin .face").first()).toBeDisabled();

  // E8: pointer input before the map has loaded. The hit test has no countries yet.
  const box = (await page.locator("#fx").boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y);
  // Before the first resize the projection is still d3's default (centre 480,250, radius 150):
  // a tap there is the one that reaches the country lookup with no countries loaded.
  if (box.width > 480 && box.height > 250) await page.mouse.click(480, 250);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 80, at.y + 20, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(400);
  expect(errors, "no page errors from input during load").toEqual([]);

  release();
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  await expect(page.locator("header")).toHaveAttribute("data-status", "ready");
  await expect(page.locator("h1")).toContainText("The world feels");
  await expect(page.locator("#loading-disc")).toBeHidden();
  await expect(page.locator("#world-count")).toBeVisible();
  expect(errors).toEqual([]);
});

test("if the map never arrives: a message and a working retry, in the user's language", async ({
  page,
}, info) => {
  only(info.project.name);
  const errors = watchErrors(page);
  let refuse = true;
  await page.route(MAP, async (route) => {
    if (refuse) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/?auto=0&lang=fr");
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );

  await expect(page.locator("header")).toHaveAttribute("data-status", "failed");
  await expect(page.locator("h1")).toHaveText("La carte n’a pas pu se charger.");
  await expect(page.locator("#loading-disc")).toBeHidden();
  await expect(page.locator("#world-count")).toBeHidden();
  await expect(page.locator("#retry")).toHaveText("Réessayer");
  await expect(page.locator("body")).not.toContainText(/didn’t load|Try again|quiet/);
  expect(errors, "the failure is caught, not thrown at the page").toEqual([]);

  refuse = false;
  await page.locator("#retry").click();
  await page.waitForFunction(() => "__bench" in window);
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  await expect(page.locator("header")).toHaveAttribute("data-status", "ready");
  await expect(page.locator("h1")).toContainText("Le monde");
});
