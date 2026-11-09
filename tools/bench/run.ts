/**
 * Globe benchmark (docs/design/phase-3-globe-spike.md §2).
 *
 *   node tools/bench/run.ts [--device=android|desktop] [--matrix=gate|phase4|opt|full] [--repeats=3]
 *                           [--no-build] [--screenshot=path.png] [--shots=dir] [--verify]
 *   node tools/bench/run.ts --restore-phone     restore Android settings after a killed run
 *   --allow-warm  skip the cool-down waits (results are slower; the file name says "-warm")
 *
 * android: serves the PRODUCTION build over `adb reverse` (nothing on the LAN), drives Chrome via
 *   the DevTools protocol, gates every run on thermal status, and restores the phone settings it
 *   touches. Originals are saved to a backup file first, so a killed run is repaired next time.
 * desktop: launches a separate Chrome with a throwaway profile (never the user's). Useful for
 *   correctness checks and relative comparisons only; desktop numbers are NOT the gate (ADR 0004).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PORT = 4173;
const arg = (k: string, d: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const flag = (k: string) => process.argv.includes(`--${k}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Scenario {
  particles: number;
  dragLod: "move" | "110m" | "50m";
  dpr: number;
  hz: 60 | 120;
  throttle: number;
  opt?: string;
  /** Keep a check-in ripple on the globe for the whole run (Phase 4 worst case). */
  ripple?: boolean;
}

interface Thermal {
  status: number;
  batteryC: number;
  waitedS: number;
}

function matrix(kind: string): Scenario[] {
  if (kind === "opt") {
    // One optimisation at a time, then combined, at the gate's 60 Hz settings (1× and 4×).
    const opts = [
      "",
      "precision0",
      "cull",
      "noborders",
      "precision0,cull",
      "precision0,cull,noborders",
    ];
    return [1, 4].flatMap((throttle) =>
      opts.map((opt) => ({
        particles: 500,
        dragLod: "110m" as const,
        dpr: 2,
        hz: 60 as const,
        throttle,
        opt,
      })),
    );
  }
  if (kind === "phase4") {
    // What Phase 4 adds to the gate's shipped setup, at 60 Hz 1× and 4×: the Phase 3 picture
    // (no night band, no ripple), + the night band, + night and a ripple running all the time.
    const shipped = "precision0,cull";
    return [1, 4].flatMap((throttle) =>
      [
        { opt: `${shipped},nonight`, ripple: false },
        { opt: shipped, ripple: false },
        { opt: shipped, ripple: true },
      ].map((v) => ({
        particles: 500,
        dragLod: "move" as const,
        dpr: 2,
        hz: 60 as const,
        throttle,
        ...v,
      })),
    );
  }
  if (kind === "gate") {
    // The pass bar (design §3) on what SHIPS: precision0 + cull, the simplified "move" map on
    // animation frames, 500 particles, DPR 2: 120 Hz, 60 Hz, 60 Hz at 4×. Baseline: the previous
    // shipped setup (110m on animation frames) at 60 Hz 1× and 4×, to show what simplifying buys.
    const shipped = "precision0,cull";
    return [
      { particles: 500, dragLod: "move", dpr: 2, hz: 120, throttle: 1, opt: shipped },
      { particles: 500, dragLod: "move", dpr: 2, hz: 60, throttle: 1, opt: shipped },
      { particles: 500, dragLod: "move", dpr: 2, hz: 60, throttle: 4, opt: shipped },
      { particles: 500, dragLod: "110m", dpr: 2, hz: 60, throttle: 1, opt: shipped },
      { particles: 500, dragLod: "110m", dpr: 2, hz: 60, throttle: 4, opt: shipped },
    ];
  }

  const out: Scenario[] = [];
  for (const hz of [120, 60] as const)
    for (const throttle of [1, 4])
      for (const dragLod of ["110m", "50m"] as const)
        for (const dpr of [1.5, 2])
          for (const particles of [0, 500, 1500])
            out.push({ particles, dragLod, dpr, hz, throttle });
  return out;
}

// ---- Devices ----------------------------------------------------------------------------------

interface Device {
  readonly name: string;
  /** Base URL of the preview server as seen from the browser. */
  readonly pageBase: string;
  /** Returns the browser-level DevTools WebSocket URL and a label for the log. */
  setup(): Promise<{ wsUrl: string; label: string }>;
  supports(s: Scenario): boolean;
  /** Prepare for one run (refresh rate, cool-down) and report thermal state. */
  beforeRun(s: Scenario): Promise<Thermal>;
  thermalNow(): Thermal;
  /** Must be safe to call more than once, and from a signal handler. */
  teardown(): void;
}

const adb = (...a: string[]) => execFileSync("adb", a, { encoding: "utf8" }).replace(/\r/g, "");

const PHONE_SETTINGS = [
  ["system", "peak_refresh_rate"],
  ["system", "min_refresh_rate"],
  ["global", "stay_on_while_plugged_in"],
] as const;
const PHONE_BACKUP = join(HERE, ".phone-settings-backup.json");
/** Values recorded on the Pixel 6 Pro on 2026-11-05 before the first bench run. */
const PIXEL_KNOWN_ORIGINALS: [string, string, string][] = [
  ["system", "peak_refresh_rate", "Infinity"],
  ["system", "min_refresh_rate", "0.0"],
  ["global", "stay_on_while_plugged_in", "15"],
];

function restorePhone(values: readonly (readonly [string, string, string])[]): void {
  for (const [ns, key, value] of values) {
    if (value === "null") adb("shell", "settings", "delete", ns, key);
    else adb("shell", "settings", "put", ns, key, value);
  }
}

function androidDevice(): Device {
  const CDP_PORT = 9222;
  let original: [string, string, string][] | null = null;
  let tornDown = false;

  /**
   * Chrome's DevTools socket name varies between Chrome versions and launches: seen as
   * `chrome_devtools_remote_<pid>` (Chrome 156, the plain name hung) and as plain
   * `chrome_devtools_remote` (Chrome 158). Try every candidate; keep the first that answers and
   * says it is com.android.chrome. Leaves the port forwarded to the winner.
   */
  const connectChrome = async (): Promise<string> => {
    const unix = adb("shell", "cat /proc/net/unix");
    const suffixed = [...new Set(unix.match(/chrome_devtools_remote_\d+/g) ?? [])].filter(
      (s) =>
        adb("shell", `cat /proc/${s.split("_").pop()}/cmdline`)
          .replace(/\0/g, " ")
          .trim() === "com.android.chrome",
    );
    const candidates = [
      ...suffixed,
      ...(/@chrome_devtools_remote\b(?!_)/.test(unix) ? ["chrome_devtools_remote"] : []),
    ];
    for (const sock of candidates) {
      adb("forward", `tcp:${CDP_PORT}`, `localabstract:${sock}`);
      const v = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
        signal: AbortSignal.timeout(3000),
      }).then(
        (r) => r.json() as Promise<{ "Android-Package"?: string }>,
        () => null,
      );
      if (v?.["Android-Package"] === "com.android.chrome") return sock;
    }
    throw new Error(
      `Chrome's DevTools socket not found (tried: ${candidates.join(", ") || "none"}). Open Chrome on the phone and keep it unlocked.`,
    );
  };
  /** Battery temperature at the first run; later runs wait to come back near it. */
  let sessionStartC: number | undefined;
  const COOL_MARGIN_C = 0.7;
  const COOL_START_C = 36;
  const thermalNow = (): Thermal => {
    const t = adb("shell", "dumpsys", "thermalservice").match(/Thermal Status: (\d+)/);
    const b = adb("shell", "dumpsys", "battery").match(/temperature: (\d+)/);
    return { status: Number(t?.[1] ?? -1), batteryC: Number(b?.[1] ?? 0) / 10, waitedS: 0 };
  };

  return {
    name: "android",
    pageBase: `http://localhost:${PORT}`,
    async setup() {
      if (existsSync(PHONE_BACKUP)) {
        // A previous run died before restoring. Repair first, then start clean.
        const stale = JSON.parse(readFileSync(PHONE_BACKUP, "utf8")) as [string, string, string][];
        restorePhone(stale);
        console.log(
          `restored phone settings left by a killed run: ${stale.map(([, k, v]) => `${k}=${v}`).join(", ")}`,
        );
      }
      original = PHONE_SETTINGS.map(([ns, key]) => [
        ns,
        key,
        adb("shell", "settings", "get", ns, key).trim(),
      ]);
      writeFileSync(PHONE_BACKUP, JSON.stringify(original));
      adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`);
      const socket = await connectChrome();
      console.log(`chrome socket: ${socket}`);
      adb("shell", "svc", "power", "stayon", "usb");
      const v = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()) as {
        webSocketDebuggerUrl: string;
        Browser: string;
      };
      return {
        wsUrl: v.webSocketDebuggerUrl,
        label: `${adb("shell", "getprop", "ro.product.model").trim()} · ${v.Browser}`,
      };
    },
    supports: () => true,
    async beforeRun(s) {
      adb("shell", "settings", "put", "system", "peak_refresh_rate", `${s.hz}.0`);
      adb("shell", "settings", "put", "system", "min_refresh_rate", `${s.hz}.0`);
      // The Pixel 6 Pro throttles when warm (status 2 at 41 °C made one scenario 1.8× slower).
      const t0 = Date.now();
      let th = thermalNow();
      // Wait for status <= 1. Android: 1 = LIGHT (no UX impact), 2 = MODERATE (UX impacted). The
      // confounded runs were at 2. Plugged in with the screen on, this phone rarely reaches 0.
      // Also wait for the battery to come back within COOL_MARGIN_C of the session's first run:
      // on 2026-11-09 it crept from 34.1 to 38 °C at status 1 and 4× runs slowed round by round
      // (the no-night baseline went from 0% to 27% missed frames).
      if (flag("allow-warm")) return th; // measured as-is; temperatures recorded, file marked
      if (sessionStartC === undefined) {
        // First run: start from a cool phone (≤ COOL_START_C, at most 10 min), so the baseline
        // every later run returns to is not itself a hot phone.
        while (th.batteryC > COOL_START_C && Date.now() - t0 < 10 * 60_000) {
          await sleep(15_000);
          th = thermalNow();
        }
        if (th.batteryC > COOL_START_C || th.status > 1)
          // Numbers from a hot phone are not comparable (2026-11-09: 41 °C and rising while fast
          // charging at 36%). Refuse rather than record them.
          throw new Error(
            `phone too warm to measure: battery ${th.batteryC} °C, thermal status ${th.status} ` +
              `after 10 min (need <= ${COOL_START_C} °C, status <= 1). Let it cool, or charge it ` +
              "first: fast charging heats it. Then run again.",
          );
        sessionStartC = th.batteryC;
        console.log(`  session start: battery ${th.batteryC} °C, thermal status ${th.status}`);
      }
      const warm = (t: Thermal) =>
        t.status > 1 || t.batteryC > (sessionStartC as number) + COOL_MARGIN_C;
      while (warm(th) && Date.now() - t0 < 10 * 60_000) {
        await sleep(15_000);
        th = thermalNow();
      }
      return { ...th, waitedS: Math.round((Date.now() - t0) / 1000) };
    },
    thermalNow,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      if (original) {
        restorePhone(original);
        rmSync(PHONE_BACKUP, { force: true });
        console.log(
          `phone settings restored: ${original.map(([, k, v]) => `${k}=${v}`).join(", ")}`,
        );
      }
      try {
        adb("reverse", "--remove", `tcp:${PORT}`);
        adb("forward", "--remove", `tcp:${CDP_PORT}`);
      } catch {}
    },
  };
}

function desktopDevice(): Device {
  const CDP_PORT = 9223;
  const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = join(tmpdir(), "world-emotion-bench-profile");
  let chrome: ChildProcess | null = null;
  let tornDown = false;
  const none: Thermal = { status: 0, batteryC: Number.NaN, waitedS: 0 };

  return {
    name: "desktop",
    pageBase: `http://127.0.0.1:${PORT}`,
    async setup() {
      rmSync(profile, { recursive: true, force: true });
      chrome = spawn(
        CHROME,
        [
          `--remote-debugging-port=${CDP_PORT}`,
          `--user-data-dir=${profile}`, // throwaway profile: never the user's
          "--no-first-run",
          "--no-default-browser-check",
          `--window-size=${arg("window", "430,932")}`, // phone-shaped by default; --window=1440,900 for wide
          // Keep rAF running at full rate even if the window is partly covered.
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
          "about:blank",
        ],
        { stdio: "ignore" },
      );
      for (let i = 0; i < 50; i++) {
        const v = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(
          (r) => r.json() as Promise<{ webSocketDebuggerUrl: string; Browser: string }>,
          () => null,
        );
        if (v) {
          const cpu = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
            encoding: "utf8",
          }).trim();
          return {
            wsUrl: v.webSocketDebuggerUrl,
            label: `${cpu} desktop · ${v.Browser} (NOT the gate device)`,
          };
        }
        await sleep(200);
      }
      throw new Error("desktop Chrome did not expose DevTools");
    },
    // The built-in display is 60 Hz and cannot be switched from here.
    supports: (s) => s.hz === 60,
    beforeRun: async () => none,
    thermalNow: () => none,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      chrome?.kill();
      // Chrome flushes the profile while exiting; retry instead of racing it.
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

// ---- Minimal CDP client (browser-level socket, flattened sessions) ---------------------------
async function cdp(url: string) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: unknown }) => void>();
  const listeners: ((m: { method?: string; sessionId?: string; params?: unknown }) => void)[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id !== undefined) pending.get(m.id)?.(m);
    else for (const l of listeners) l(m);
  };
  const send = async <T = Record<string, unknown>>(
    method: string,
    params: object = {},
    sessionId?: string,
  ): Promise<T> => {
    const m = await new Promise<{ result?: unknown; error?: unknown }>((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
    if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`);
    return m.result as T;
  };
  const once = (method: string, sessionId: string) =>
    new Promise<void>((res) =>
      listeners.push((m) => m.method === method && m.sessionId === sessionId && res()),
    );
  const onEvent = (fn: (m: { method?: string; sessionId?: string; params?: unknown }) => void) => {
    listeners.push(fn);
  };
  return { ws, send, once, onEvent };
}
type Cdp = Awaited<ReturnType<typeof cdp>>;

/** Open a fresh tab at `url`, run `fn`, always close the tab. */
async function withPage<T>(b: Cdp, url: string, fn: (sessionId: string) => Promise<T>): Promise<T> {
  const { targetId } = await b.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await b.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  try {
    await b.send("Target.activateTarget", { targetId });
    await b.send("Page.enable", {}, sessionId);
    const loaded = b.once("Page.loadEventFired", sessionId);
    await b.send("Page.navigate", { url }, sessionId);
    await loaded;
    await b.send(
      "Runtime.evaluate",
      { expression: "window.__bench.ready", awaitPromise: true },
      sessionId,
    );
    return await fn(sessionId);
  } finally {
    await b.send("Emulation.setCPUThrottlingRate", { rate: 1 }, sessionId).catch(() => {});
    await b.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

const evaluate = async (b: Cdp, sessionId: string, expression: string) =>
  (
    await b.send<{ result: { value: Record<string, unknown> } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
  ).result.value;

// Frame timing comes from rAF intervals (BeginFrame-aligned). No display-side cross-check: on the
// Pixel, `dumpsys gfxinfo` counts only Chrome's toolbar and SurfaceFlinger `--latency` records
// nothing for the web-content layers. See ADR 0005.

// ---- Main -----------------------------------------------------------------------------------
async function main() {
  if (flag("restore-phone")) {
    const values = existsSync(PHONE_BACKUP)
      ? (JSON.parse(readFileSync(PHONE_BACKUP, "utf8")) as [string, string, string][])
      : PIXEL_KNOWN_ORIGINALS;
    restorePhone(values);
    rmSync(PHONE_BACKUP, { force: true });
    console.log(`phone settings restored: ${values.map(([, k, v]) => `${k}=${v}`).join(", ")}`);
    return;
  }

  const device = arg("device", "android") === "desktop" ? desktopDevice() : androidDevice();
  const all = matrix(arg("matrix", "gate"));
  const scenarios = all.filter((s) => device.supports(s));
  if (scenarios.length < all.length)
    console.log(`skipping ${all.length - scenarios.length} scenario(s) this device cannot run`);
  const repeats = Number(arg("repeats", "3"));
  const screenshot = arg("screenshot", "");
  const shotsDir = arg("shots", "");
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  if (!flag("no-build"))
    execFileSync("pnpm", ["--filter", "@world-emotion/web", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  // Refuse a busy port: a leaked server from an earlier run would otherwise be reused silently.
  if (
    await fetch(`http://127.0.0.1:${PORT}/`).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`port ${PORT} is already in use (a leaked preview server?); stop it first`);
  // Vite directly, not via pnpm: killing a pnpm wrapper leaves its vite child running.
  const preview: ChildProcess = spawn(
    join(ROOT, "apps/web/node_modules/.bin/vite"),
    ["preview", "--port", String(PORT), "--strictPort"],
    {
      cwd: join(ROOT, "apps/web"),
      stdio: "ignore",
    },
  );

  // Restore on Ctrl-C / terminal close too. (A hard kill can't be caught: that is what the
  // phone backup file is for.)
  const cleanup = () => {
    device.teardown();
    preview.kill();
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(sig, () => {
      cleanup();
      process.exit(130);
    });

  const results: unknown[] = [];
  try {
    for (let i = 0; i < 50; i++) {
      if (
        await fetch(`http://127.0.0.1:${PORT}/`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await sleep(200);
    }
    const { wsUrl, label } = await device.setup();
    const b = await cdp(wsUrl);
    console.log(`device: ${label}`);

    const tourDir = arg("tour", "");
    if (tourDir) {
      // Real-browser walkthrough: every theme, then drill into Europe and France. Any page error
      // fails the tour.
      mkdirSync(tourDir, { recursive: true });
      await withPage(b, `${device.pageBase}/`, async (sid) => {
        const errors: string[] = [];
        b.onEvent((m) => {
          if (m.sessionId !== sid) return;
          if (m.method === "Runtime.exceptionThrown")
            errors.push(JSON.stringify(m.params).slice(0, 300));
          if (
            m.method === "Log.entryAdded" &&
            (m.params as { entry?: { level?: string } })?.entry?.level === "error"
          )
            errors.push(JSON.stringify(m.params).slice(0, 300));
        });
        await b.send("Runtime.enable", {}, sid);
        await b.send("Log.enable", {}, sid);
        const shot = async (name: string) =>
          writeFileSync(
            join(tourDir, `${name}.png`),
            Buffer.from(
              (await b.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sid))
                .data,
              "base64",
            ),
          );
        const moods = ["happy", "calm", "excited", "stressed", "sad", "angry"];
        for (const [m, name] of moods.entries()) {
          await evaluate(b, sid, `(document.querySelectorAll("#dev button")[${m}].click(), 1)`);
          await sleep(9000); // hysteresis needs a couple of 2 s aggregation steps, then a 2.5 s fade
          const headline = await evaluate(
            b,
            sid,
            `document.getElementById("world-mood").textContent`,
          );
          console.log(`theme ${name}: headline now "${String(headline)}"`);
          await shot(`theme-${m}-${name}`);
        }
        const tap = async (lon: number, lat: number) => {
          const p = (await evaluate(
            b,
            sid,
            `window.__bench.screenPoint(${lon}, ${lat})`,
          )) as unknown as [number, number] | null;
          if (!p) throw new Error(`point ${lon},${lat} is on the far side`);
          for (const type of ["mousePressed", "mouseReleased"])
            await b.send(
              "Input.dispatchMouseEvent",
              { type, x: p[0], y: p[1], button: "left", clickCount: 1 },
              sid,
            );
        };
        await evaluate(b, sid, `(document.querySelectorAll("#dev button")[1].click(), 1)`);
        await sleep(6000);
        await b.send("Runtime.evaluate", { expression: "1" }, sid);
        // Face Europe first so France is on the near side, then tap it.
        await evaluate(b, sid, `(window.__bench.face(10, 45), 1)`);
        await sleep(300);
        await tap(2.5, 46.5);
        await sleep(1800);
        const panel1 = await evaluate(
          b,
          sid,
          `document.getElementById("panel-title").textContent + " | " + document.getElementById("panel-sub").textContent`,
        );
        console.log(`after tap 1 (expect Europe): ${String(panel1)}`);
        await shot("drill-1-europe");
        await tap(2.5, 46.5);
        await sleep(800);
        const panel2 = await evaluate(
          b,
          sid,
          `document.getElementById("panel-title").textContent + " | " + document.getElementById("panel-sub").textContent`,
        );
        console.log(`after tap 2 (expect France): ${String(panel2)}`);
        await shot("drill-2-france");
        await evaluate(b, sid, `(document.getElementById("back").click(), 1)`);
        await sleep(1800);
        const backHidden = await evaluate(b, sid, `document.getElementById("panel").hidden`);
        console.log(`after back (expect panel hidden=true): ${String(backHidden)}`);
        await shot("drill-3-back");
        console.log(
          errors.length
            ? `PAGE ERRORS (${errors.length}):\n${errors.join("\n")}`
            : "page errors: none",
        );
      });
      b.ws.close();
      return;
    }
    if (flag("verify")) {
      // Correctness of render optimisations: pixel-compare against the reference renderer.
      await withPage(b, `${device.pageBase}/?bench=1&particles=0`, async (sid) => {
        for (const variant of [
          { cull: true, precision0: false },
          { cull: false, precision0: true },
          { cull: true, precision0: true },
          // Self-test: culling against the WRONG view centre must produce large differences;
          // if it reports 0, the comparison itself is broken.
          { cull: true, precision0: false, selfTestWrongCenter: true },
        ]) {
          const v = await evaluate(
            b,
            sid,
            `window.__bench.verifyRender(${JSON.stringify(variant)})`,
          );
          console.log(`verify ${JSON.stringify(variant)}: ${JSON.stringify(v)}`);
        }
      });
      b.ws.close();
      return;
    }

    // Repeats outermost, scenario order rotated each repeat: no scenario always runs last (hottest).
    for (let r = 0; r < repeats; r++) {
      const shift = r * Math.ceil(scenarios.length / repeats);
      const order = scenarios.map((_, i) => scenarios[(i + shift) % scenarios.length] as Scenario);
      for (const s of order) {
        const before = await device.beforeRun(s);
        if (before.status > 1 || before.waitedS >= 600)
          console.log(
            `  (warning: still warm after ${before.waitedS}s: status ${before.status}, battery ${before.batteryC} °C)`,
          );
        const url = `${device.pageBase}/?bench=1&particles=${s.particles}&dragLod=${s.dragLod}&dpr=${s.dpr}&hz=${s.hz}&seconds=10&opt=${s.opt ?? ""}&ripple=${s.ripple ? 1 : 0}`;
        await withPage(b, url, async (sid) => {
          await b.send("Emulation.setCPUThrottlingRate", { rate: s.throttle }, sid);
          const v = (await evaluate(b, sid, "window.__bench.run()")) as Record<string, number>;
          if ((screenshot && results.length === 0) || (shotsDir && r === 0)) {
            const png = Buffer.from(
              (await b.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sid))
                .data,
              "base64",
            );
            if (screenshot && results.length === 0) writeFileSync(screenshot, png);
            if (shotsDir)
              writeFileSync(
                join(
                  shotsDir,
                  `${s.throttle}x-${(s.opt || "none").replace(/,/g, "+")}${s.ripple ? "+ripple" : ""}.png`,
                ),
                png,
              );
          }
          const after = device.thermalNow();
          results.push({
            ...s,
            repeat: r,
            device: device.name,
            deviceLabel: label,
            ...v,
            thermalBefore: before,
            thermalAfter: after,
          });
          const f = (x: number | undefined) => (x ?? Number.NaN).toFixed(2);
          console.log(
            `${s.hz}Hz ${s.throttle}x ${s.dragLod} dpr${s.dpr} p${s.particles} [${s.opt || "none"}${s.ripple ? " +ripple" : ""}] #${r}: ` +
              `idle ${f(v.idleIntervalP50)} · interval p50 ${f(v.intervalP50)} p95 ${f(v.intervalP95)} · ` +
              `script p50 ${f(v.scriptP50)} p95 ${f(v.scriptP95)} (base ${f(v.baseP50)} fx ${f(v.fxP50)}) · ` +
              `idleDetail ${JSON.stringify((v as unknown as Record<string, unknown>).idleDetail)} · missed ${((v.missedRatio ?? 0) * 100).toFixed(2)}% · thermal ${before.status}→${after.status} (waited ${before.waitedS}s)`,
          );
        });
      }
    }
    b.ws.close();
  } finally {
    cleanup();
  }
  const out = join(
    ROOT,
    `docs/bench/${new Date().toISOString().slice(0, 10)}-${device.name}-${arg("matrix", "gate")}${flag("allow-warm") ? "-warm" : ""}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  // In the repo's own style, so committing results never fails CI's format check (it did twice).
  execFileSync("pnpm", ["exec", "biome", "format", "--write", out], { cwd: ROOT, stdio: "ignore" });
  console.log(`results: ${out}`);
}

await main();
