/**
 * POST /checkin at the boundary, in workerd, against the real local D1 and rate-limit bindings
 * (docs/design/phase-5-api.md §6, exit criterion 4).
 */
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../src/app";
import { call, checkin, freshIp, ORIGIN, rowFor } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("a check-in is stored, once per device", () => {
  it("first check-in from Canada counts for Canada", async () => {
    const body = checkin({ mood: 2 });
    const before = Math.floor(Date.now() / 1000);
    const res = await call(body, { cf: "CA" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counted: "country", conn: "CA", replay: false });
    const row = await rowFor(body.deviceKey);
    expect(row).toMatchObject({ country: "CA", mood: 2, last_checkin_id: body.checkinId });
    expect(row?.created_at).toBeGreaterThanOrEqual(before);
    expect(row?.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("the device key itself is never stored, only its keyed hash", async () => {
    const body = checkin();
    await call(body, { cf: "CA" });
    const row = await rowFor(body.deviceKey);
    expect(row?.voter_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(body.deviceKey);
  });

  it("a new check-in replaces the device's vote (one row per device)", async () => {
    const body = checkin({ mood: 0 });
    await call(body, { cf: "FR" });
    const second = { ...body, mood: 4, checkinId: crypto.randomUUID() };
    const res = await call(second, { cf: "FR" });
    expect(await res.json()).toMatchObject({ replay: false });
    expect(await rowFor(body.deviceKey)).toMatchObject({
      mood: 4,
      last_checkin_id: second.checkinId,
    });
    const h = (await rowFor(body.deviceKey))?.voter_hash;
    const n = await env.DB.prepare("SELECT count(*) AS n FROM votes WHERE voter_hash = ?")
      .bind(h)
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("a replay changes nothing: not the mood, not the time (README G7)", async () => {
    const body = checkin({ mood: 3 });
    await call(body, { cf: "BR" });
    const row = await rowFor(body.deviceKey);
    // Age the stored vote, so a refreshed created_at would show.
    await env.DB.prepare("UPDATE votes SET created_at = created_at - 3600 WHERE voter_hash = ?")
      .bind(row?.voter_hash)
      .run();
    const res = await call({ ...body, mood: 5 }, { cf: "BR" }); // same checkinId
    expect(await res.json()).toEqual({ counted: "country", conn: "BR", replay: true });
    expect(await rowFor(body.deviceKey)).toEqual({
      ...row,
      created_at: (row?.created_at ?? 0) - 3600,
    });
  });
});

describe("where it counts (README §5.6)", () => {
  it("a pick that matches the connection counts for that country", async () => {
    const body = checkin({ country: "NG" });
    expect(await (await call(body, { cf: "NG" })).json()).toMatchObject({ counted: "country" });
    expect((await rowFor(body.deviceKey))?.country).toBe("NG");
  });

  it("a Canadian picking the United States counts for the world, and the pick is not kept", async () => {
    const body = checkin({ country: "US" });
    const res = await call(body, { cf: "CA" });
    expect(await res.json()).toEqual({ counted: "world", conn: "CA", replay: false });
    expect((await rowFor(body.deviceKey))?.country).toBeNull();
  });

  it.each(["XX", "T1"])("connection %s is unknown: world only, not logged", async (cf) => {
    const spy = vi.spyOn(console, "log");
    const body = checkin();
    expect(await (await call(body, { cf })).json()).toEqual({
      counted: "world",
      conn: null,
      replay: false,
    });
    expect((await rowFor(body.deviceKey))?.country).toBeNull();
    expect(spy.mock.calls.flat().join()).not.toContain("unknown_cf_country");
  });

  it("no connection country at all: world only", async () => {
    const body = checkin({ country: "DE" });
    expect(await (await call(body)).json()).toMatchObject({ counted: "world", conn: null });
  });

  it("an unrecognised connection code is logged (no IP, no device), and counts for the world", async () => {
    const spy = vi.spyOn(console, "log");
    const body = checkin();
    const ip = freshIp();
    await call(body, { cf: "QZ", ip });
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain('{"event":"unknown_cf_country","code":"QZ"}');
    expect(logged).not.toContain(ip);
    expect(logged).not.toContain(body.deviceKey);
    expect((await rowFor(body.deviceKey))?.country).toBeNull();
  });
});

describe("input validation", () => {
  it.each([
    ["mood out of range", { mood: 6 }, ["mood"]],
    ["mood as text", { mood: "happy" }, ["mood"]],
    ["lower-case country", { country: "ca" }, ["country"]],
    ["country we do not know", { country: "QZ" }, ["country"]],
    ["retired code", { country: "AN" }, ["country"]],
    ["bad checkinId", { checkinId: "1" }, ["checkinId"]],
    ["bad deviceKey", { deviceKey: "me" }, ["deviceKey"]],
  ])("rejects %s with 400 naming the field", async (_, over, fields) => {
    const body = checkin(over as never);
    const res = await call(body, { cf: "CA" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", fields });
    expect(await rowFor(body.deviceKey)).toBeNull();
  });

  it("rejects unknown keys (no free text, ever)", async () => {
    const res = await call({ ...checkin(), note: "hello" }, { cf: "CA" });
    expect(res.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await call(null, { raw: "{mood:1", cf: "CA" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-JSON content type with 415", async () => {
    const res = await call(checkin(), { type: "text/plain", cf: "CA" });
    expect(res.status).toBe(415);
  });

  it("accepts application/json with a charset", async () => {
    const res = await call(checkin(), { type: "application/json; charset=utf-8", cf: "CA" });
    expect(res.status).toBe(200);
  });

  it("rejects a body over the limit with 413, before parsing it", async () => {
    const big = JSON.stringify({ ...checkin(), pad: "x".repeat(MAX_BODY_BYTES) });
    const res = await call(null, { raw: big, cf: "CA" });
    expect(res.status).toBe(413);
  });

  it("a body exactly at the limit is read (and then judged on its content)", async () => {
    const base = JSON.stringify({ ...checkin(), pad: "" });
    const exact = base.replace('"pad":""', `"pad":"${"x".repeat(MAX_BODY_BYTES - base.length)}"`);
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_BODY_BYTES);
    expect((await call(null, { raw: exact, cf: "CA" })).status).toBe(400); // unknown key, not 413
  });
});

describe("CORS and routes", () => {
  it("answers an allowed origin with its own origin, never a wildcard", async () => {
    const res = await call(checkin(), { cf: "CA" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it.each([
    ["no Origin header", null],
    ["another site", "https://evil.example"],
    ["a near miss", "http://localhost:51730"],
  ])("refuses %s with 403 and writes nothing", async (_, origin) => {
    const body = checkin();
    const res = await call(body, { origin, cf: "CA" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await rowFor(body.deviceKey)).toBeNull();
  });

  it("preflight: allowed origin gets 204 with methods and headers", async () => {
    const res = await call(null, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("preflight: other origins get 403 and no CORS headers", async () => {
    const res = await call(null, { method: "OPTIONS", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("GET /checkin is 405; anything else is 404", async () => {
    const get = await call(null, { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST, OPTIONS");
    expect((await call(checkin(), { path: "/snapshot.json" })).status).toBe(404);
  });
});

describe("rate limits (real bindings, wrangler.jsonc limits)", () => {
  it("a device gets 3 check-ins a minute; the 4th is 429 with Retry-After and not stored", async () => {
    const deviceKey = crypto.randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const b = checkin({ deviceKey, mood: i });
      ids.push(b.checkinId);
      expect((await call(b, { cf: "CA" })).status).toBe(200);
    }
    const res = await call(checkin({ deviceKey, mood: 5 }), { cf: "CA" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN); // so the app can read it
    expect((await rowFor(deviceKey))?.last_checkin_id).toBe(ids[2]);
  });

  it("an IP gets 10 check-ins a minute across devices; the 11th is 429", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await call(checkin(), { ip, cf: "CA" })).status).toBe(200);
    const last = checkin();
    expect((await call(last, { ip, cf: "CA" })).status).toBe(429);
    expect(await rowFor(last.deviceKey)).toBeNull();
  });
});

describe("dev-only simulator headers", () => {
  it("the test environment has them off and its own secrets (not a developer's .dev.vars)", () => {
    expect(env.SIMULATE).toBe("0");
    expect(env.DEVICE_HASH_SECRET).toBe("test-device-secret");
  });

  it("are ignored unless SIMULATE=1", async () => {
    const body = checkin();
    const res = await call(body, { cf: "CA", headers: { "x-sim-country": "FR" } });
    expect(await res.json()).toMatchObject({ conn: "CA" });
  });

  it("set the connection country when SIMULATE=1", async () => {
    const res = await call(checkin(), {
      cf: "CA",
      headers: { "x-sim-country": "FR" },
      env: { SIMULATE: "1" },
    });
    expect(await res.json()).toMatchObject({ conn: "FR", counted: "country" });
  });
});

describe("failures", () => {
  it("D1 failing (down, or the daily cap) is 503 with Retry-After, and logged", async () => {
    const spy = vi.spyOn(console, "log");
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: limit reached");
      },
    } as unknown as D1Database;
    const res = await call(checkin(), { cf: "CA", env: { DB: broken } });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(spy.mock.calls.flat().join()).toContain("d1_error");
  });

  it.each(["DEVICE_HASH_SECRET", "IP_SALT_SECRET"] as const)(
    "a missing %s is a 500 that says why in the log, and stores nothing",
    async (name) => {
      const spy = vi.spyOn(console, "log");
      const body = checkin();
      const res = await call(body, { cf: "CA", env: { [name]: "" } });
      expect(res.status).toBe(500);
      expect(spy.mock.calls.flat().join()).toContain('"event":"misconfigured"');
      expect(await rowFor(body.deviceKey)).toBeNull();
    },
  );
});
