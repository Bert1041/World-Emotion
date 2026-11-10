import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { app, type Env } from "../src/app";
import { voterHash } from "../src/hash";

export const ORIGIN = "http://localhost:5173";
let ipSeq = 0;
/** A fresh IP per request unless one is given, so the per-IP limit only bites where tested. */
export const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

export interface PostOptions {
  cf?: string;
  ip?: string;
  origin?: string | null;
  type?: string;
  raw?: string;
  headers?: Record<string, string>;
  env?: Partial<Env>;
  method?: string;
  path?: string;
}

export async function call(body: unknown, o: PostOptions = {}): Promise<Response> {
  const headers = new Headers({ "Content-Type": o.type ?? "application/json", ...o.headers });
  if (o.origin !== null) headers.set("Origin", o.origin ?? ORIGIN);
  headers.set("CF-Connecting-IP", o.ip ?? freshIp());
  const method = o.method ?? "POST";
  const init: RequestInit<IncomingRequestCfProperties> = { method, headers };
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS")
    init.body = o.raw ?? JSON.stringify(body);
  if (o.cf) init.cf = { country: o.cf } as IncomingRequestCfProperties;
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://api.test${o.path ?? "/checkin"}`, init),
    { ...env, ...o.env },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

export const checkin = (
  over: Partial<{ mood: number; country: string; checkinId: string; deviceKey: string }> = {},
) => ({
  mood: 1,
  checkinId: crypto.randomUUID(),
  deviceKey: crypto.randomUUID(),
  ...over,
});

export interface Row {
  voter_hash: string;
  country: string | null;
  mood: number;
  created_at: number;
  last_checkin_id: string;
}

export async function rowFor(deviceKey: string): Promise<Row | null> {
  const h = await voterHash(env.DEVICE_HASH_SECRET, deviceKey);
  return env.DB.prepare("SELECT * FROM votes WHERE voter_hash = ?").bind(h).first<Row>();
}
