import { randomBytes } from "crypto";
import { prisma } from "../db";

// Rotating hash salt for the cookieless visit key. Ported from iq-rest
// (apps/dashboard-api/src/analytics-v2/salt.service.ts) and translator
// (lib/analytics/salt.ts), made multi-tenant: this service serves several
// sites from one process, so every salt row (and its cache entry / rotation
// lock) is keyed by siteId instead of being a single global singleton.
//
// No nightly cron — like translator, rotation is lazy-on-read only. The
// service runs as a single pm2 fork process, so an in-memory cache/lock is
// the whole truth; a clustered deployment would need this moved to a shared
// store.

const SALT_ROW_ID = "current";
// Rotation boundary: 04:00 Europe/Madrid — the dead hour for the EU
// audience, so a visit cut in half by the salt change is a rare statistical
// blip.
const ROTATION_HOUR = 4;
// In-memory cache TTL — the ingest path must not hit the DB for the salt on
// every event.
const CACHE_TTL_MS = 60_000;

interface SaltRow {
  value: string;
  rotatedAt: Date;
}

/** Salt-day key: the Madrid calendar date of (t − 4h). Two timestamps share a
 *  salt iff they fall between the same pair of 04:00-Madrid boundaries. */
function saltPeriodKey(t: Date): string {
  const shifted = new Date(t.getTime() - ROTATION_HOUR * 3600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

const cache = new Map<string, { value: string; readAt: number }>();
/** Single-flight guard per site. Two requests for the same site arriving
 *  together just after a boundary would otherwise both rotate, and the
 *  second overwrite would orphan every hash the first one produced. */
const rotating = new Map<string, Promise<SaltRow>>();

/** Overwrite the per-site singleton with a fresh random salt. The overwrite
 *  destroys the previous salt — that is what makes yesterday's hashes
 *  unlinkable. */
async function rotate(siteId: string): Promise<SaltRow> {
  // Re-check under the guard: the caller may have queued behind a rotation
  // that already moved us into the current salt-day.
  const existing = await prisma.analyticsSalt.findUnique({ where: { siteId_id: { siteId, id: SALT_ROW_ID } } });
  if (existing && saltPeriodKey(existing.rotatedAt) === saltPeriodKey(new Date())) {
    cache.set(siteId, { value: existing.value, readAt: Date.now() });
    return existing;
  }
  const row = await prisma.analyticsSalt.upsert({
    where: { siteId_id: { siteId, id: SALT_ROW_ID } },
    create: { siteId, id: SALT_ROW_ID, value: randomBytes(32).toString("hex"), rotatedAt: new Date() },
    update: { value: randomBytes(32).toString("hex"), rotatedAt: new Date() },
  });
  cache.set(siteId, { value: row.value, readAt: Date.now() });
  return row;
}

function rotateOnce(siteId: string): Promise<SaltRow> {
  const inflight = rotating.get(siteId);
  if (inflight) return inflight;
  const p = rotate(siteId).finally(() => rotating.delete(siteId));
  rotating.set(siteId, p);
  return p;
}

/** Current salt for a site. Rotates lazily when the stored one is from a
 *  previous salt-day, so the first ingest call after 04:00 Madrid pays one
 *  upsert. */
export async function getSalt(siteId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(siteId);
  if (hit && now - hit.readAt < CACHE_TTL_MS) return hit.value;

  let row: SaltRow | null = await prisma.analyticsSalt.findUnique({
    where: { siteId_id: { siteId, id: SALT_ROW_ID } },
  });
  if (!row || saltPeriodKey(row.rotatedAt) !== saltPeriodKey(new Date())) {
    row = await rotateOnce(siteId);
  }
  cache.set(siteId, { value: row.value, readAt: now });
  return row.value;
}
