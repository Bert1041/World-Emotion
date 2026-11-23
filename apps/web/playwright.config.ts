import { defineConfig } from "@playwright/test";

/** Every screen shape we care about, phone to ultrawide (the layout rule must hold on all). */
export const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 740 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop-1280", width: 1280, height: 720 },
  { name: "laptop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "desktop-2560", width: 2560, height: 1440 },
  { name: "ultrawide-3440", width: 3440, height: 1440 },
] as const;

/** Project order for sharding (see `projects` below); every viewport exactly once. */
const SHARD_ORDER = [
  "tablet-landscape",
  "phone-landscape",
  "phone-390",
  "desktop-1920",
  "phone-430",
  "laptop-1280",
  "laptop-1440",
  "ultrawide-3440",
  "desktop-2560",
  "phone-360",
  "tablet-portrait",
] as const satisfies readonly (typeof VIEWPORTS)[number]["name"][];
if (new Set(SHARD_ORDER).size !== VIEWPORTS.length)
  throw new Error("SHARD_ORDER must list every viewport exactly once");

const PORT = 4174; // not 4173 (bench) or 5173 (dev)
/** The local API for e2e/live.spec.ts; not 8787 (wrangler dev). */
export const API_PORT = 8788;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  workers: 3,
  reporter: [["list"]],
  use: {
    channel: "chrome", // the installed Google Chrome; no browser download
    baseURL: `http://127.0.0.1:${PORT}`,
    deviceScaleFactor: 2,
    // PW_NO_GPU=1 renders like CI (no GPU: software raster), to reproduce its timing locally.
    launchOptions: { args: process.env.PW_NO_GPU ? ["--disable-gpu"] : [] },
  },
  // CI runs the suite in 3 shards, cut into equal test counts in project order. The big screens
  // have few tests but are the slowest to draw (software raster), and listed last they all landed
  // in shard 3: 1,726 test-seconds against 622 and 859 (PR #15, 2026-11-23). This order mixes
  // heavy and light in each third: 1,028 / 1,033 / 1,038 s by that run's per-test timings
  // (checked against Playwright's own --shard listing; re-check if the suite's shape changes).
  projects: SHARD_ORDER.map((name) => {
    const v = VIEWPORTS.find((x) => x.name === name);
    if (v === undefined) throw new Error(`unknown viewport ${name}`);
    return { name, use: { viewport: { width: v.width, height: v.height } } };
  }),
  webServer: [
    {
      command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The real API and aggregator for e2e/live.spec.ts (Phase 6): a fresh local D1 and R2 each
      // run, test secrets, SIMULATE=1 (x-sim-country, and snapshot.json served from R2), this
      // page's origin allowed, and the cron triggerable over HTTP.
      command: [
        "cd ../api && rm -rf .wrangler/e2e",
        "pnpm exec wrangler d1 migrations apply world-emotion --local --persist-to .wrangler/e2e",
        `pnpm exec wrangler dev --local --port ${API_PORT} --persist-to .wrangler/e2e --test-scheduled` +
          ` --var SIMULATE:1 --var ALLOWED_ORIGINS:http://127.0.0.1:${PORT}` +
          " --var DEVICE_HASH_SECRET:e2e-device --var IP_SALT_SECRET:e2e-ip",
      ].join(" && "),
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
