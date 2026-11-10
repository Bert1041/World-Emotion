/** Keyed hashes: device keys and IPs are never stored or logged, only HMACs of them. */
const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Same device → same row, forever (until the secret rotates). */
export const voterHash = (secret: string, deviceKey: string) =>
  hmacHex(secret, `device:${deviceKey}`);

/**
 * Rate-limit key for an IP. The UTC date is part of the input, so the key rotates daily
 * (README §5.6: throttle without being able to follow an IP across days).
 */
export const ipKey = (secret: string, ip: string, nowMs: number) =>
  hmacHex(secret, `ip:${new Date(nowMs).toISOString().slice(0, 10)}:${ip}`);
