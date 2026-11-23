/**
 * Real data, end to end, locally (docs/design/phase-6-live-data.md §5–6, exit criteria 1, 3, 7, 8):
 * check-ins → the real API → local D1 → the aggregator (cron, triggered over HTTP) → R2 →
 * snapshot.json → the production build polling it in a real browser. The API runs beside the app
 * (playwright.config.ts, second web server) with a fresh database per run.
 *
 * One project only, in order: every test shares that one database.
 */

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { buildSnapshot } from "@world-emotion/core";
import { COUNTRY_TO_CONTINENT } from "@world-emotion/geo-data";

const API = "http://127.0.0.1:8788"; // API_PORT in playwright.config.ts
const ORIGIN = "http://127.0.0.1:4174";
const SNAPSHOT = `${API}/snapshot.json`;

type Bench = {
  ready: Promise<void>;
  aggregate(): void;
  fill(code: string): string | null;
  snapshotAt(): number;
};
const snapshotAt = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.snapshotAt());

test.describe.configure({ mode: "serial" });
/** One shared database: one project. */
const one = (name: string) => test.skip(name !== "laptop-1440", "one shared database: one project");

let ip = 0;
/** Check-ins as the simulator sends them: a country from x-sim-country, a fresh IP each. */
async function vote(request: APIRequestContext, country: string, mood: number, times: number) {
  for (let i = 0; i < times; i++) {
    const res = await request.post(`${API}/checkin`, {
      headers: {
        Origin: ORIGIN,
        "x-sim-country": country,
        "x-sim-ip": `10.77.${Math.floor(++ip / 250)}.${ip % 250}`,
      },
      data: { mood, checkinId: crypto.randomUUID(), deviceKey: crypto.randomUUID() },
    });
    expect(res.status(), await res.text()).toBe(200);
  }
}

/** One aggregator run. Runs at or before the last one write nothing, so keep them a second apart. */
async function cron(request: APIRequestContext) {
  await new Promise((r) => setTimeout(r, 1100));
  const res = await request.get(`${API}/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`);
  expect(res.status()).toBe(200);
}

async function served(request: APIRequestContext) {
  return (await request.get(SNAPSHOT)).json() as Promise<{
    generatedAt: number;
    world: { n: number };
    countries: Record<string, { n: number }>;
  }>;
}

async function open(page: Page) {
  await page.goto(`/?auto=0&live=${API}`);
  await page.evaluate(() => {
    localStorage.setItem("we.pin", JSON.stringify({ code: "NG", lon: 8.6, lat: 9.1 }));
    localStorage.setItem("we.checkedIn", "1");
  });
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
}

test("end to end: check-ins reach the app through D1, the aggregator and R2, and the colour eases in", async ({
  page,
  request,
}, info) => {
  one(info.project.name);
  // Calm, the quiet Earth's own mood: when the world wakes up the theme stays, so the only colour
  // that changes is Nigeria's.
  await vote(request, "NG", 1, 4);
  await cron(request);
  expect((await served(request)).countries.NG, "4 check-ins: below the floor").toBeUndefined();

  await open(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.snapshotAt()))
    .toBeGreaterThan(0);
  await expect(page.locator("#world-count .count")).toHaveAttribute("data-value", "4");

  await vote(request, "NG", 1, 1);
  await cron(request);
  expect((await served(request)).countries.NG?.n, "5: published").toBe(5);

  // Poll now, and record Nigeria's fill on every frame while the new snapshot arrives.
  const fills = await page.evaluate(
    () =>
      new Promise<(string | null)[]>((done) => {
        const b = (window as unknown as { __bench: Bench }).__bench;
        const out: (string | null)[] = [b.fill("NG")];
        const t0 = performance.now();
        b.aggregate();
        const frame = (t: number) => {
          out.push(b.fill("NG"));
          if (t - t0 < 4000) requestAnimationFrame(frame);
          else done(out);
        };
        requestAnimationFrame(frame);
      }),
  );
  await expect(page.locator("#world-count .count")).toHaveAttribute("data-value", "5");
  expect(fills.at(-1), "Nigeria's colour changed").not.toBe(fills[0]);
  const changed = fills.filter((f, i) => i > 0 && f !== fills[i - 1]).length;
  expect(changed, "eased over many frames, not one jump").toBeGreaterThanOrEqual(15);
});

test("a check-in from the app goes to the real API; from another country it counts for the world", async ({
  page,
  request,
}, info) => {
  one(info.project.name);
  const before = await served(request);
  await open(page);
  // The page's own request, with the connection's country set as the simulator does.
  await page.route(`${API}/checkin`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-sim-country": "FR" } }),
  );
  const answer = page.waitForResponse(`${API}/checkin`);
  await page.locator('#checkin .face[data-mood="happy"]').click();
  expect(await (await answer).json()).toEqual({ counted: "world", conn: "FR", replay: false });

  await expect(page.locator("#checkin-world-only")).toHaveText(
    "Counts for the world: your connection is in France.",
  );
  expect(await page.evaluate(() => localStorage.getItem("we.conn"))).toBe("FR");
  expect(
    await page.evaluate(() => localStorage.getItem("we.pendingCheckin")),
    "delivered",
  ).toBeNull();

  await cron(request);
  const after = await served(request);
  expect(after.world.n, "counted for the world").toBe(before.world.n + 1);
  expect(after.countries.NG?.n, "not for Nigeria").toBe(before.countries.NG?.n);
});

test("keeps the last good snapshot on a newer version, a 500 and invalid JSON", async ({
  page,
}, info) => {
  one(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect.poll(() => snapshotAt(page)).toBeGreaterThan(0);
  const good = await snapshotAt(page);
  const count = await page.locator("#world-count .count").getAttribute("data-value");

  const real = await (await page.request.get(SNAPSHOT)).json();
  for (const [name, reply] of [
    [
      "a newer version",
      { status: 200, body: JSON.stringify({ ...real, v: 2, generatedAt: good + 999 }) },
    ],
    ["a 500", { status: 500, body: '{"error":"boom"}' }],
    ["invalid JSON", { status: 200, body: "{not json" }],
  ] as const) {
    let hits = 0;
    await page.route(SNAPSHOT, (route) => {
      hits++;
      return route.fulfill({
        ...reply,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
    await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
    await expect.poll(() => hits, `${name}: the app polled`).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.snapshotAt()),
      name,
    ).toBe(good);
    await expect(page.locator("#world-count .count"), name).toHaveAttribute(
      "data-value",
      count ?? "",
    );
    await page.unroute(SNAPSHOT);
  }
  expect(errors).toEqual([]);
});

test("old numbers say how old they are", async ({ page }, info) => {
  one(info.project.name);
  const old = Math.floor(Date.now() / 1000) - 23 * 60;
  const snapshot = buildSnapshot({
    counts: [{ country: "NG", mood: 1, n: 9 }],
    countryToContinent: COUNTRY_TO_CONTINENT,
    now: old,
  }).snapshot;
  await page.route(SNAPSHOT, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot),
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await open(page);
  await expect(page.locator("#updated-ago")).toHaveText("Updated 23 min ago");
});

test("does not poll while the page is hidden", async ({ page }, info) => {
  one(info.project.name);
  await page.addInitScript(() => {
    const w = window as unknown as { __hidden: boolean };
    w.__hidden = false;
    Object.defineProperty(document, "hidden", { get: () => w.__hidden });
  });
  let hits = 0;
  await page.route(SNAPSHOT, (route) => {
    hits++;
    return route.continue();
  });
  // Let the poll made on load finish first: a request already on its way when the tab hides is
  // fine; starting one while hidden is not.
  const first = page.waitForResponse(SNAPSHOT);
  await open(page);
  await first;
  await page.evaluate(() => {
    (window as unknown as { __hidden: boolean }).__hidden = true;
  });
  hits = 0;
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
  await page.waitForTimeout(1500);
  expect(hits, "hidden").toBe(0);
  await page.evaluate(() => {
    (window as unknown as { __hidden: boolean }).__hidden = false;
  });
  await expect.poll(() => hits, "visible again").toBeGreaterThan(0);
});

test("a check-in that cannot be delivered says so, and goes out when the connection is back", async ({
  page,
  request,
}, info) => {
  // QA on the hosted app (2026-11-22): a 429, a 500 or no network looked exactly like a counted
  // check-in, and the kept one only went again on the next start.
  one(info.project.name);
  const before = await served(request);
  await open(page);
  await page.route(`${API}/checkin`, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.locator('#checkin .face[data-mood="sad"]').click();
  await expect(page.locator("#checkin-unsent")).toHaveText(
    "Saved on this phone. It will count once it reaches us.",
  );

  // The connection comes back while the page stays open: it goes at once, and the notice goes.
  await page.unroute(`${API}/checkin`);
  const sent = page.waitForResponse(
    (r) => r.url() === `${API}/checkin` && r.request().method() === "POST",
  );
  await page.evaluate(() => dispatchEvent(new Event("online")));
  expect((await sent).status()).toBe(200);
  await expect(page.locator("#checkin-unsent")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("we.pendingCheckin"))).toBeNull();
  await cron(request);
  expect((await served(request)).world.n, "counted once").toBe(before.world.n + 1);
});

test("a kept check-in older than its window is never sent", async ({ page, request }, info) => {
  // Found 2026-11-23: the kept check-in had no time, so a phone offline overnight sent
  // yesterday's mood in the morning and the server counted it for another 6 hours.
  one(info.project.name);
  const before = await served(request);
  await open(page);
  await page.route(`${API}/checkin`, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.locator('#checkin .face[data-mood="angry"]').click();
  await expect(page.locator("#checkin-unsent")).toBeVisible();

  // Seven hours pass offline (both the kept check-in and the remembered mood are that old).
  await page.evaluate(() => {
    const ago = Date.now() - 7 * 3_600_000;
    const kept = JSON.parse(localStorage.getItem("we.pendingCheckin") ?? "{}");
    localStorage.setItem("we.pendingCheckin", JSON.stringify({ ...kept, at: ago }));
    localStorage.setItem("we.current", JSON.stringify({ mood: 5, at: ago }));
  });
  await page.unroute(`${API}/checkin`);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.url() === `${API}/checkin` && r.method() === "POST") posts.push(r.url());
  });
  await page.reload();
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.ready);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await page.waitForTimeout(1500);

  expect(posts, "nothing sent").toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem("we.pendingCheckin"))).toBeNull();
  await expect(page.locator("#checkin-unsent")).toHaveCount(0);
  await expect(page.locator("#checkin")).toHaveAttribute("data-mode", "faces");
  await cron(request);
  expect((await served(request)).world.n, "not counted").toBe(before.world.n);
});

test("the count includes you even when you tap before the first snapshot has loaded", async ({
  page,
  request,
}, info) => {
  // QA on the hosted app (2026-11-22): tapping before the first snapshot arrived showed the
  // server's count without you (2, not 3) until the next run.
  one(info.project.name);
  const before = (await served(request)).world.n;
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(SNAPSHOT, async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await page.locator('#checkin .face[data-mood="calm"]').click();
  await expect(page.locator(".flight")).toHaveCount(0, { timeout: 15_000 }); // landed
  release(); // the snapshot (made before your vote) arrives now
  await expect.poll(() => snapshotAt(page)).toBeGreaterThan(0);
  await expect(page.locator("#world-count .count")).toHaveAttribute(
    "data-value",
    String(before + 1),
  );
  // The next run includes you: still one more than before, not two.
  await cron(request);
  await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.aggregate());
  await expect.poll(async () => (await served(request)).world.n).toBe(before + 1);
  await page.waitForTimeout(1500);
  await expect(page.locator("#world-count .count")).toHaveAttribute(
    "data-value",
    String(before + 1),
  );
});
