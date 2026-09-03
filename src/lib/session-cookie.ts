import { createHash, createHmac, timingSafeEqual } from "crypto";

// Signed admin session cookie. Self-contained (no server-side session store):
// the cookie value IS the proof, an HMAC-signed `<payload>.<sig>` pair, in
// the same spirit as visit-token.ts. There is exactly one admin account, so a
// DB-backed session table would only add a lookup for no real benefit.

export const SESSION_COOKIE_NAME = "mtx_sess";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionPayload {
  /** Admin username this cookie authenticates as (informational only — there
   *  is only one account, but this keeps the payload self-describing and
   *  makes a future multi-admin extension a smaller diff). */
  u: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(user: string, secret: string, now: Date = new Date()): string {
  const body: SessionPayload = { u: user, exp: now.getTime() + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/** Returns the admin username a valid, unexpired cookie authenticates, else
 *  null. */
export function verifySession(token: string | undefined | null, secret: string, now: Date = new Date()): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Partial<SessionPayload>;
    if (typeof data.u !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < now.getTime()) return null;
    return data.u;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (hash-then-compare, so differing lengths
 *  don't short-circuit and leak timing). Used for the admin username check —
 *  the password itself is verified via scrypt in password.ts. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}
