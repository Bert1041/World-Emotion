/**
 * Traffic simulator (docs/design/phase-5-api.md §6, exit criterion 3). Starts `wrangler dev` on a
 * throwaway database, sends real HTTP check-ins, and checks every outcome by querying that local
 * D1 directly: nothing here trusts the API's own answers alone.
 *
 *   pnpm --filter @world-emotion/simulate simulate
 *
 * Connection country and IP are set with x-sim-* headers, which the Worker honours only when
 * SIMULATE=1 (set here, never in production).
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PURGE_BUFFER_SECONDS, PURGE_SQL } from "../../apps/api/src/purge-sql.ts";

const API_DIR = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const PORT = 8790;
const URL_ = `http://127.0.0.1:${PORT}/checkin`;
const ORIGIN = "http://localhost:5173";
const WINDOW = 6 * 60 * 60;
const persist = mkdtempSync(join(tmpdir(), "we-sim-"));

// 50 real codes for the troll (all in packages/geo-data's set).
const COUNTRIES =
  "CA US MX BR AR CL CO PE GB FR DE ES IT PT NL BE CH AT SE NO DK FI PL CZ HU RO GR TR RU UA EG NG KE ZA MA GH ET IN PK BD CN JP KR ID PH VN TH AU NZ SA".split(
    " ",
  );

// ------------------------------------------------------------------------------------------------
// Plumbing
// ------------------------------------------------------------------------------------------------

const wrangler = (args: string[]) =>
  execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: API_DIR,
    encoding: "utf8",
    stdio: "pipe",
  });

function sql<T>(command: string): T[] {
  const out = wrangler([
    "d1",
    "execute",
    "world-emotion",
    "--local",
    "--persist-to",
    persist,
    "--json",
    "--command",
    command,
  ]);
  return (JSON.parse(out) as { results: T[] }[]).flatMap((r) => r.results);
}
const one = (command: string) => sql<{ n: number }>(command)[0]?.n ?? Number.NaN;

async function startServer(): Promise<ChildProcess> {
  wrangler(["d1", "migrations", "apply", "world-emotion", "--local", "--persist-to", persist]);
  const child = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--port",
      String(PORT),
      "--persist-to",
      persist,
      "--var",
      "SIMULATE:1",
      "--var",
      "DEVICE_HASH_SECRET:sim-device-secret",
      "--var",
      "IP_SALT_SECRET:sim-ip-secret",
    ],
    { cwd: API_DIR, stdio: "pipe", detached: true },
  );
  let log = "";
  child.stdout?.on("data", (d) => {
    log += d;
  });
  child.stderr?.on("data", (d) => {
    log += d;
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(URL_, { method: "OPTIONS", headers: { Origin: ORIGIN } });
      if (r.status === 204) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not start:\n${log}`);
}

interface Sent {
  status: number;
  body: { counted?: string; conn?: string | null; replay?: boolean };
}

interface Checkin {
  mood: number;
  checkinId: string;
  deviceKey: string;
  country?: string;
}

async function send(c: Checkin, conn: string, ip: string): Promise<Sent> {
  const r = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "x-sim-country": conn,
      "x-sim-ip": ip,
    },
    body: JSON.stringify(c),
  });
  return { status: r.status, body: (await r.json()) as Sent["body"] };
}

/** At most `limit` requests in flight. */
async function pool<T, R>(items: T[], limit: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i] as T);
      }
    }),
  );
  return out;
}

let ipSeq = 0;
const newIp = () => {
  ipSeq++;
  return `172.${16 + (ipSeq >> 16)}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};
const statuses = (rs: Sent[]) => {
  const m: Record<number, number> = {};
  for (const r of rs) m[r.status] = (m[r.status] ?? 0) + 1;
  return m;
};
const tableHash = () =>
  createHash("sha256")
    .update(JSON.stringify(sql("SELECT * FROM votes ORDER BY voter_hash")))
    .digest("hex");

const results: { scenario: string; detail: string; ok: boolean }[] = [];
function check(scenario: string, detail: string, ok: boolean) {
  results.push({ scenario, detail, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${scenario}: ${detail}`);
}
const reset = () => sql("DELETE FROM votes");

// ------------------------------------------------------------------------------------------------
// Scenarios
// ------------------------------------------------------------------------------------------------

type Device = { c: Checkin; conn: string; ip: string };
const CONNS = ["CA", "FR", "BR", "NG", "IN", "JP"];
/** Fresh devices, each on its own IP. Each scenario uses its own, so the per-minute limits
 *  (3 per device, 10 per IP) only bite where a scenario means them to. */
const devices = (n: number): Device[] =>
  Array.from({ length: n }, (_, i) => ({
    c: { mood: i % 6, checkinId: randomUUID(), deviceKey: randomUUID() },
    conn: CONNS[i % CONNS.length] as string,
    ip: newIp(),
  }));

async function spike() {
  reset();
  // 1,000 devices in one burst, each from its own IP, spread over 6 countries.
  const sent = devices(1000);
  const t0 = performance.now();
  const rs = await pool(sent, 50, (s) => send(s.c, s.conn, s.ip));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const ok = rs.filter((r) => r.status === 200).length;
  check("spike", `1000 devices in ${secs} s → ${JSON.stringify(statuses(rs))}`, ok === 1000);
  check(
    "spike",
    `rows in D1 = accepted (${one("SELECT count(*) AS n FROM votes")} = ${ok})`,
    one("SELECT count(*) AS n FROM votes") === ok,
  );
  const perCountry = sql<{ country: string; n: number }>(
    "SELECT country, count(*) AS n FROM votes GROUP BY country ORDER BY country",
  );
  check(
    "spike",
    `each connection country got its share: ${JSON.stringify(perCountry.map((r) => `${r.country}:${r.n}`))}`,
    perCountry.length === 6 && perCountry.every((r) => r.n >= 166 && r.n <= 167),
  );
}

async function sharedIpSpike() {
  reset();
  // 1,000 devices behind only 20 IPs (offices, carrier NAT): the per-IP limit (10/min) bites.
  // The limiter counts in fixed one-minute windows, so a burst that crosses a minute boundary
  // (CI is slower) legitimately gets a fresh 10 per IP: allow 10 per IP per window touched.
  const ips = Array.from({ length: 20 }, newIp);
  const startMin = Math.floor(Date.now() / 60_000);
  const rs = await pool(
    Array.from({ length: 1000 }, (_, i) => i),
    50,
    async (i) => ({
      ip: ips[i % 20] as string,
      r: await send(
        { mood: i % 6, checkinId: randomUUID(), deviceKey: randomUUID() },
        "CA",
        ips[i % 20] as string,
      ),
    }),
  );
  const windows = Math.floor(Date.now() / 60_000) - startMin + 1;
  const s = statuses(rs.map((x) => x.r));
  const perIp = new Map<string, number>();
  for (const { ip, r } of rs) if (r.status === 200) perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  const counts = [...perIp.values()];
  const rows = one("SELECT count(*) AS n FROM votes");
  check(
    "shared-IP spike",
    `1000 devices / 20 IPs over ${windows} limiter window(s) → ${JSON.stringify(s)}; accepted per IP ${Math.min(...counts)}–${Math.max(...counts)} (limit 10 × ${windows})`,
    counts.length === 20 &&
      counts.every((n) => n >= 10 && n <= 10 * windows) &&
      (s[200] ?? 0) + (s[429] ?? 0) === 1000,
  );
  check(
    "shared-IP spike",
    `rows in D1 = accepted (${rows} = ${s[200]}): 429s store nothing`,
    rows === s[200],
  );
}

async function replays() {
  // 1,000 check-ins, then all re-sent (an offline queue flushing twice).
  reset();
  const sent = devices(1000);
  await pool(sent, 50, (s) => send(s.c, s.conn, s.ip));
  const before = tableHash();
  await new Promise((r) => setTimeout(r, 1100)); // a refreshed created_at would now differ
  const rs = await pool(sent, 50, (s) => send({ ...s.c, mood: (s.c.mood + 1) % 6 }, s.conn, s.ip));
  const replayed = rs.filter((r) => r.status === 200 && r.body.replay === true).length;
  check(
    "replays",
    `1000 replays (same checkinId, different mood) → ${replayed} answered replay:true`,
    replayed === 1000,
  );
  check(
    "replays",
    "table byte-identical before and after (no mood, no created_at change)",
    tableHash() === before,
  );
}

async function waves() {
  // 1,000 devices check in, then change mood twice: new check-ins replace, never add.
  reset();
  const sent = devices(1000);
  await pool(sent, 50, (s) => send(s.c, s.conn, s.ip));
  for (const wave of [1, 2]) {
    const rs = await pool(sent, 50, (s) =>
      send({ ...s.c, mood: (s.c.mood + wave) % 6, checkinId: randomUUID() }, s.conn, s.ip),
    );
    const s = statuses(rs);
    const rows = one("SELECT count(*) AS n FROM votes");
    const moved = one(
      `SELECT count(*) AS n FROM votes WHERE last_checkin_id NOT IN (${sent.map((x) => `'${x.c.checkinId}'`).join(",")})`,
    );
    check(
      `wave ${wave}`,
      `${JSON.stringify(s)}; rows ${rows} (still 1000); updated ${moved}`,
      s[200] === 1000 && rows === 1000 && moved === 1000,
    );
  }
}

async function troll() {
  reset();
  // One person in Canada with a VPN-free connection, 50 devices and 50 IPs (dodging the limits),
  // "voting" angry for 50 countries. Only the pick that matches the connection counts locally.
  const rs = await pool(COUNTRIES, 10, (country) =>
    send({ mood: 5, checkinId: randomUUID(), deviceKey: randomUUID(), country }, "CA", newIp()),
  );
  const s = statuses(rs);
  const byCountry = sql<{ country: string | null; n: number }>(
    "SELECT country, count(*) AS n FROM votes GROUP BY country ORDER BY country",
  );
  const world = rs.filter((r) => r.body.counted === "world").length;
  check(
    "troll",
    `50 picks from Canada → ${JSON.stringify(s)}, ${world} told "world only"`,
    s[200] === 50 && world === 49,
  );
  check(
    "troll",
    `D1 by country: ${JSON.stringify(byCountry)} (no country but CA gets a vote; picks not stored)`,
    JSON.stringify(byCountry) ===
      JSON.stringify([
        { country: null, n: 49 },
        { country: "CA", n: 1 },
      ]),
  );
}

async function purge() {
  reset();
  const rs = await pool(
    Array.from({ length: 100 }, (_, i) => i),
    20,
    (i) => send({ mood: i % 6, checkinId: randomUUID(), deviceKey: randomUUID() }, "FR", newIp()),
  );
  const now = Math.floor(Date.now() / 1000);
  const cut = now - WINDOW - PURGE_BUFFER_SECONDS;
  // Age 60 votes: 59 well past the cut, 1 exactly on it (expired); 1 more one second short (kept).
  sql(
    `UPDATE votes SET created_at = ${cut - 3600} WHERE voter_hash IN (SELECT voter_hash FROM votes ORDER BY voter_hash LIMIT 59)`,
  );
  sql(
    `UPDATE votes SET created_at = ${cut} WHERE voter_hash = (SELECT voter_hash FROM votes WHERE created_at > ${cut} ORDER BY voter_hash LIMIT 1)`,
  );
  sql(
    `UPDATE votes SET created_at = ${cut + 1} WHERE voter_hash = (SELECT voter_hash FROM votes WHERE created_at > ${cut + 1} ORDER BY voter_hash LIMIT 1)`,
  );
  sql(PURGE_SQL.replace("?1", String(cut)));
  const left = one("SELECT count(*) AS n FROM votes");
  const oldest = one("SELECT min(created_at) AS n FROM votes");
  check(
    "purge",
    `${statuses(rs)[200]} stored, 60 expired → ${left} left; oldest kept is cut+1`,
    left === 40 && oldest === cut + 1,
  );
}

// ------------------------------------------------------------------------------------------------

const server = await startServer();
try {
  await spike();
  await replays();
  await waves();
  await sharedIpSpike();
  await troll();
  await purge();
} finally {
  if (server.pid) process.kill(-server.pid, "SIGTERM");
  rmSync(persist, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
