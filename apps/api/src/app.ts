/**
 * The API Worker: one write endpoint, `POST /checkin` (README §3, docs/design/phase-5-api.md).
 * Order of checks: route → origin → content type → size → JSON → schema → known country →
 * rate limits → one D1 statement. Each rejection is cheap and happens before the next step.
 */
import { isKnownCountry } from "@world-emotion/geo-data";
import { type CheckinResponse, checkinRequestSchema } from "@world-emotion/shared";
import { Hono } from "hono";
import { readLimited } from "./body";
import { saveVote } from "./db";
import { ipKey, voterHash } from "./hash";
import { connection, place } from "./where";

export interface Env {
  DB: D1Database;
  IP_LIMITER: RateLimit;
  DEVICE_LIMITER: RateLimit;
  /** Comma-separated exact origins. */
  ALLOWED_ORIGINS: string;
  DEVICE_HASH_SECRET: string;
  IP_SALT_SECRET: string;
  /** "1" only in local dev: honour x-sim-country / x-sim-ip from tools/simulate. */
  SIMULATE?: string;
}

export const MAX_BODY_BYTES = 1024;
export const RETRY_AFTER_SECONDS = 60;

const origins = (env: Env) =>
  new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

export const app = new Hono<{ Bindings: Env }>();

app.options("/checkin", (c) => {
  const origin = c.req.header("Origin");
  if (!origin || !origins(c.env).has(origin)) return reply(403, { error: "origin" });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
});

app.post("/checkin", async (c) => {
  const env = c.env;
  const origin = c.req.header("Origin");
  if (!origin || !origins(env).has(origin)) return reply(403, { error: "origin" });
  const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };

  if (!env.DEVICE_HASH_SECRET || !env.IP_SALT_SECRET) {
    log({ event: "misconfigured", missing: "secret" });
    return reply(500, { error: "server" }, cors);
  }

  const type = c.req.header("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return reply(415, { error: "type" }, cors);

  const text = await readLimited(c.req.raw, MAX_BODY_BYTES);
  if (text === null) return reply(413, { error: "size" }, cors);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid", fields: [] }, cors);
  }
  const parsed = checkinRequestSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))];
    return reply(400, { error: "invalid", fields }, cors);
  }
  const req = parsed.data;
  if (req.country !== undefined && !isKnownCountry(req.country))
    return reply(400, { error: "invalid", fields: ["country"] }, cors);

  const sim = env.SIMULATE === "1";
  const cfCountry = (sim && c.req.header("x-sim-country")) || c.req.raw.cf?.country;
  const ip = (sim && c.req.header("x-sim-ip")) || c.req.header("CF-Connecting-IP") || "unknown";
  const { conn, unrecognised } = connection(typeof cfCountry === "string" ? cfCountry : null);
  if (unrecognised) log({ event: "unknown_cf_country", code: unrecognised });

  const now = Date.now();
  const [voter, ipk] = await Promise.all([
    voterHash(env.DEVICE_HASH_SECRET, req.deviceKey),
    ipKey(env.IP_SALT_SECRET, ip, now),
  ]);
  const [byIp, byDevice] = await Promise.all([
    env.IP_LIMITER.limit({ key: ipk }),
    env.DEVICE_LIMITER.limit({ key: voter }),
  ]);
  if (!byIp.success || !byDevice.success)
    return reply(429, { error: "rate" }, { ...cors, "Retry-After": String(RETRY_AFTER_SECONDS) });

  const where = place(req.country, conn);
  try {
    const { replay } = await saveVote(env.DB, {
      voterHash: voter,
      country: where.stored,
      mood: req.mood,
      createdAt: Math.floor(now / 1000),
      checkinId: req.checkinId,
    });
    const body: CheckinResponse = { counted: where.counted, conn, replay };
    return reply(200, body, cors);
  } catch (e) {
    // D1 down or the free plan's daily cap reached: the app queues and says "will count shortly".
    log({ event: "d1_error", message: e instanceof Error ? e.message : String(e) });
    return reply(
      503,
      { error: "unavailable" },
      { ...cors, "Retry-After": String(RETRY_AFTER_SECONDS) },
    );
  }
});

app.all("/checkin", () => reply(405, { error: "method" }, { Allow: "POST, OPTIONS" }));
app.notFound(() => reply(404, { error: "not_found" }));
