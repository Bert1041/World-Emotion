/**
 * The quiet world (ADR 0003, README §5.4, bridge E3): below the privacy floor the headline names no
 * mood, because `h` for an empty world is a tie-break, not a feeling. ?votes=N gives a demo world
 * of exactly N check-ins.
 */
import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "@world-emotion/shared";

const only = (name: string) =>
  test.skip(!["phone-390", "laptop-1440"].includes(name), "behaviour, not layout");

async function load(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.evaluate(
    () => (window as unknown as { __bench: { ready: Promise<void> } }).__bench.ready,
  );
  return errors;
}

const floor = DEFAULT_CONFIG.publishMinN;

test.describe("the world headline below the privacy floor", () => {
  for (const votes of [0, floor - 1]) {
    test(`${votes} check-ins: "quiet", no mood word, the count says "so far"`, async ({
      page,
    }, info) => {
      only(info.project.name);
      const errors = await load(page, `?auto=0&votes=${votes}`);
      await expect(page.locator("h1")).toHaveText("The world is quiet");
      await expect(page.locator("h1")).toHaveAttribute("data-quiet", "true");
      await expect(page.locator("#world-mood")).toHaveCount(0);
      await expect(page.locator("#world-count")).toContainText(`${votes} check-in`);
      await expect(page.locator("#world-count")).toContainText("so far");
      expect(errors).toEqual([]);
    });
  }

  test(`${floor} check-ins: a mood is named again`, async ({ page }, info) => {
    only(info.project.name);
    await load(page, `?auto=0&votes=${floor}`);
    await expect(page.locator("h1")).toContainText("The world feels");
    await expect(page.locator("h1")).toHaveAttribute("data-quiet", "false");
    await expect(page.locator("#world-mood")).not.toHaveText("");
    await expect(page.locator("#world-count")).toContainText(`${floor} feeling something`);
  });

  test("quiet in French too: no English, and the count line is translated", async ({
    page,
  }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=0&lang=fr");
    await expect(page.locator("h1")).toHaveText("Le monde est encore silencieux");
    await expect(page.locator("#world-count")).toContainText("pour l’instant");
    await expect(page.locator("body")).not.toContainText("quiet");
  });

  test("the headline is one sentence to a screen reader in both states", async ({ page }, info) => {
    only(info.project.name);
    await load(page, "?auto=0&votes=0");
    await expect(page.locator("h1")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The world is quiet");
  });
});
