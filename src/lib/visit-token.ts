import { createHmac, timingSafeEqual } from "crypto";

// Visit continuation token: `<visitId>.<issuedAtMs>.<hmac>`. The ingest
// response hands it to the caller, which is expected to hold it only for the
// lifetime of the live page/tab and echo it on subsequent batches. It exists
// because the device hash is built from the network prefix + geo, and on
// mobile networks those flap mid-visit: the same person, same tab, produces a
// second hash and therefore a second visit row seconds after the first. The
// token pins the batch to the visit row directly, so a hash change no longer
// splits it.
//
// The HMAC only proves WE minted the id — without it anyone could append
// events to an arbitrary visit by guessing cuids. `iat` bounds replay; the
// real liveness gate is the row's own lastAt (30-min idle window), checked by
// visit.ts.
//
// Ported from iq-rest (apps/dashboard-api/src/analytics-v2/visit-token.ts) /
// translator (lib/analytics/visit-token.ts). Signed with INGEST_SHARED_SECRET
// rather than a dedicated token secret — this service has no separate
// "ANALYTICS_TOKEN_SECRET" env var, and a visit token only ever crosses the
// /ingest boundary that secret already gates, so reusing it (with the SCOPE
// prefix below for domain separation) avoids adding another env var for the
// same trust boundary. Unlike the reference implementations, tokens here are
// therefore never "disabled" — INGEST_SHARED_SECRET is mandatory.

const TOKEN_TTL_MS = 30 * 60_000;
const TOKEN_MAX_CHARS = 200;
// Domain separation, in case this secret is ever reused for something else.
const SCOPE = "visit-v1";

function mac(visitId: string, iat: number, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${SCOPE}|${visitId}|${iat}`).digest();
}

export function signVisitToken(visitId: string, secret: string, now: Date): string {
  const iat = now.getTime();
  return `${visitId}.${iat}.${mac(visitId, iat, secret).toString("base64url")}`;
}

/** Returns the visitId a valid, unexpired token points at, else null. */
export function verifyVisitToken(token: string, secret: string, now: Date): string | null {
  if (token.length > TOKEN_MAX_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [visitId, iatRaw, sig] = parts;
  const iat = Number(iatRaw);
  if (!visitId || !Number.isFinite(iat)) return null;
  const age = now.getTime() - iat;
  if (age > TOKEN_TTL_MS || age < -60_000) return null;
  let given: Buffer;
  try {
    given = Buffer.from(sig ?? "", "base64url");
  } catch {
    return null;
  }
  const expected = mac(visitId, iat, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return visitId;
}
