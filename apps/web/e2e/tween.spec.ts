/**
 * Country colours ease to a new snapshot instead of jumping (docs/design/phase-6-live-data.md §3,
 * exit criterion 1). Before Phase 6 only the theme cross-faded; at real 5-minute steps a jump
 * would be a visible snap. Measured on the drawn fill, frame by frame, in a real browser.
 *
 * The stimulus changes exactly one country's colour and nothing else: `?votes=4` gives the first
 * country 4 check-ins (below the privacy floor) and leaves the world quiet, so the Earth's theme
 * cannot change; your check-in there makes 5, and the next snapshot publishes the country.
 */
import { expect, type Page, test } from "@playwright/test";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";

type Bench = {
  ready: Promise<void>;
  aggregate(): void;
  fill(code: string): string | null;
};
const [FIRST] = COUNTRY_TO_CONTINENT.keys();
const CODE = FIRST as string;

async function checkInBelowTheFloor(page: Page) {
  await page.goto("/?auto=0&votes=4");
  await page.evaluate((code) => {
    localStorage.setItem("we.pin", JSON.stringify({ code, lon: 0, lat: 0 }));
  }, CODE);
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await page.locator('#checkin .face[data-mood="happy"]').click();
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "chip");
  await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 }); // face has landed
}

/** Force the snapshot that publishes the country, and record its fill on every frame for `ms`. */
const publishAndRecord = (page: Page, ms: number) =>
  page.evaluate(
    ([code, ms]) =>
      new Promise<(string | null)[]>((done) => {
        const b = (window as unknown as { __bench: Bench }).__bench;
        const fills: (string | null)[] = [b.fill(code as string)];
        b.aggregate();
        const t0 = performance.now();
        const frame = (t: number) => {
          fills.push(b.fill(code as string));
          if (t - t0 < (ms as number)) requestAnimationFrame(frame);
          else done(fills);
        };
        requestAnimationFrame(frame);
      }),
    [CODE, ms] as const,
  );

const changedFrames = (fills: (string | null)[]) =>
  fills.filter((f, i) => i > 0 && f !== fills[i - 1]).length;

test("a new snapshot's colour arrives over many frames, not in one jump", async ({
  page,
}, info) => {
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  await checkInBelowTheFloor(page);
  const fills = await publishAndRecord(page, 2500);
  expect(fills.at(-1), "the country's colour changed").not.toBe(fills[0]);
  // A jump changes the colour on one frame. Eased over 1.5 s (~90 frames), on many.
  expect(changedFrames(fills), fills.join(" ")).toBeGreaterThanOrEqual(15);

  // And it lands exactly where an instant switch does (same data under reduced motion), not a
  // step short: the frame the tween ends must still draw its target.
  const instant = await page.context().browser()?.newPage({ reducedMotion: "reduce" });
  if (!instant) throw new Error("no browser");
  await checkInBelowTheFloor(instant);
  const target = (await publishAndRecord(instant, 300)).at(-1);
  await instant.close();
  expect(fills.at(-1), "where the tween ends").toBe(target);
});

test("under reduced motion, the colour switches at once", async ({ page }, info) => {
  test.skip(!["phone-390", "laptop-1440"].includes(info.project.name), "behaviour, not layout");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await checkInBelowTheFloor(page);
  const fills = await publishAndRecord(page, 1500);
  expect(fills.at(-1), "the country's colour changed").not.toBe(fills[0]);
  expect(changedFrames(fills)).toBe(1);
});
