import { Prisma, type Visit } from "@prisma/client";
import { prisma } from "../db";
import { visitKey } from "./session-hash";
import type { VisitSeed } from "./request-facts";
import type { Attribution } from "./meta-sanitizer";

// One visit = one row. A visit starts anonymous (keyed by the day-scoped
// device hash) and is promoted in place the moment an email resolves, so the
// events fired before identification stay on the same row.
//
// Visits of the same person on other days are separate rows sharing an
// email — the (future) admin screen groups them. Anonymous rows from other
// salt-days stay unlinkable by construction: the salt that produced their
// hash is gone.
//
// Ported from iq-rest (apps/dashboard-api/src/analytics-v2/visit.service.ts)
// and translator (lib/analytics/visit.ts), made multi-tenant (every lookup is
// scoped by siteId — two different sites must never resolve, fold or
// continue each other's rows) and adapted to a generic `meta` Json bag for
// custom per-site fields. `from`/`ref`/`theme` keep the reference
// implementations' own dedicated columns and first-write-wins semantics
// (applyAttribution below) — only the transport changed: they arrive as
// three reserved keys inside `meta` instead of a separate `ctx` object, see
// meta-sanitizer.ts's extractAttribution. Ad/click-id columns are dropped
// entirely (out of scope — being removed from both source products).

/** A visit ends after this much silence. Without it a "visit" is the whole
 *  salt-day: a morning arrival and an unrelated evening sign-in from the
 *  same NAT'd ip+ua land on one row. */
export const VISIT_IDLE_MS = 30 * 60_000;

export type { VisitSeed } from "./request-facts";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** updateMany, not update: a concurrent batch may have folded this row away
 *  between the read and the write, and `update` would throw P2025 and fail a
 *  request whose only job was to bump a timestamp. */
async function touch(id: string, now: Date): Promise<void> {
  await prisma.visit.updateMany({ where: { id }, data: { lastAt: now } });
}

/** Move an anonymous row's events onto the signed-in row and drop it. */
async function fold(anon: Visit, target: Visit, now: Date): Promise<Visit> {
  const anonMeta = (anon.meta && typeof anon.meta === "object" ? anon.meta : {}) as Record<string, string>;
  const targetMeta = (target.meta && typeof target.meta === "object" ? target.meta : {}) as Record<string, string>;
  const [, merged] = await prisma.$transaction([
    prisma.event.updateMany({ where: { visitId: anon.id }, data: { visitId: target.id } }),
    prisma.visit.update({
      where: { id: target.id },
      data: {
        lastAt: now,
        mergeCount: { increment: 1 },
        firstAt: anon.firstAt < target.firstAt ? anon.firstAt : target.firstAt,
        // Meta/attribution the anonymous half carried that the signed-in row
        // lacks — target's own values always win. Same "never overwrite a
        // set value" rule as applyAttribution's null guard below, just
        // expressed in-transaction here since both rows are already in hand.
        meta: { ...anonMeta, ...targetMeta },
        ...(target.app === null && anon.app !== null ? { app: anon.app } : {}),
        ...(target.from === null && anon.from !== null ? { from: anon.from } : {}),
        ...(target.ref === null && anon.ref !== null ? { ref: anon.ref } : {}),
        ...(target.theme === null && anon.theme !== null ? { theme: anon.theme } : {}),
      },
    }),
    // deleteMany, not delete: two concurrent batches can both decide to fold,
    // and `delete` on an already-deleted row aborts the whole transaction
    // (P2025) — losing the second batch's events.
    prisma.visit.deleteMany({ where: { id: anon.id } }),
  ]);
  return merged;
}

/** Find, promote or create the live visit row for this device hash +
 *  identity, scoped to one site. `seed` is only used when a row has to be
 *  created. */
export async function resolveVisit(
  siteId: string,
  hash: string,
  email: string | null,
  seed: VisitSeed,
  now: Date,
): Promise<Visit> {
  // Only rows still inside the idle window can continue; anything older is a
  // finished visit and must not absorb new events.
  const liveSince = new Date(now.getTime() - VISIT_IDLE_MS);
  const rows = await prisma.visit.findMany({
    where: { siteId, hash, lastAt: { gte: liveSince } },
    orderBy: { firstAt: "asc" },
  });
  const mine = rows.find((r) => r.email === email) ?? null;
  const anon = email ? (rows.find((r) => r.email === null) ?? null) : null;

  if (mine) {
    // Signed out mid-visit and back in: fold the stray anonymous row in.
    if (anon) return fold(anon, mine, now);
    await touch(mine.id, now);
    return { ...mine, lastAt: now };
  }

  if (anon && email) {
    // Promote in place — keeps firstAt and every pre-identification event on
    // the row. Keyed off the visit's own start so two racing promotions
    // produce the same key and one of them loses cleanly.
    const key = visitKey(hash, email, anon.firstAt);
    try {
      return await prisma.visit.update({
        where: { id: anon.id },
        data: { email, visitKey: key, lastAt: now },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A concurrent batch promoted it first.
      const won = await prisma.visit.findUnique({ where: { siteId_visitKey: { siteId, visitKey: key } } });
      if (won) return won;
    }
  }

  const key = visitKey(hash, email, now);
  try {
    return await prisma.visit.create({
      data: { siteId, visitKey: key, hash, email, ...seed, firstAt: now, lastAt: now },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const won = await prisma.visit.findUnique({ where: { siteId_visitKey: { siteId, visitKey: key } } });
    if (won) return won;
    throw e;
  }
}

/**
 * Continue the exact visit a client-echoed token points at. Bypasses the
 * device hash entirely — this is the fix for mid-visit hash flaps (mobile
 * network prefix / geo changing between batches). Returns null when the row
 * is gone, idle-expired, belongs to a DIFFERENT site than the caller
 * declared (the token itself carries no siteId — see visit-token.ts — so
 * this check is what stops a token minted for one site being replayed
 * against another), or belongs to a different signed-in identity than the
 * caller (signed out mid-visit, or a shared browser switched accounts) — the
 * caller then falls back to the hash path.
 */
export async function continueVisit(
  siteId: string,
  visitId: string,
  email: string | null,
  now: Date,
): Promise<Visit | null> {
  const row = await prisma.visit.findUnique({ where: { id: visitId } });
  if (!row || row.siteId !== siteId) return null;
  if (row.lastAt.getTime() < now.getTime() - VISIT_IDLE_MS) return null;

  if (row.email === email) {
    await touch(row.id, now);
    return { ...row, lastAt: now };
  }

  if (row.email === null && email) {
    // Identified mid-visit: promote in place, exactly like the hash path.
    const key = visitKey(row.hash, email, row.firstAt);
    try {
      return await prisma.visit.update({
        where: { id: row.id },
        data: { email, visitKey: key, lastAt: now },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return await prisma.visit.findUnique({ where: { siteId_visitKey: { siteId, visitKey: key } } });
    }
  }

  return null;
}

/** Latest-wins patch applied on every ingest call: `app` (if the caller sent
 *  one) and the merged `meta` snapshot (see meta-sanitizer.ts). Unlike
 *  applyAttribution below (first-write-wins), this is deliberately
 *  latest-wins — Visit.meta is documented as "the denormalized latest
 *  values", and a visit can legitimately move between sub-apps or contexts
 *  (e.g. an owner switching restaurants). Skipped entirely when there is
 *  nothing new to write, so a plain pageview batch costs no extra query. */
export async function applyIngestSnapshot(
  visit: Visit,
  patch: { app: string | null; meta: Record<string, string> },
  now: Date,
): Promise<void> {
  const existingMeta = (visit.meta && typeof visit.meta === "object" ? visit.meta : {}) as Record<string, string>;
  const metaChanged = Object.keys(patch.meta).some((k) => existingMeta[k] !== patch.meta[k]);
  const appChanged = patch.app !== null && patch.app !== visit.app;
  if (!metaChanged && !appChanged) return;

  await prisma.visit.updateMany({
    where: { id: visit.id },
    data: {
      lastAt: now,
      ...(appChanged ? { app: patch.app } : {}),
      ...(metaChanged ? { meta: { ...existingMeta, ...patch.meta } } : {}),
    },
  });
}

/**
 * First-write-wins enrichment for from/ref/theme, ported from the reference
 * implementations' enrich() (iq-rest's visit.service.ts / translator's
 * visit.ts) — same semantics, adapted to this service's dedicated
 * applyAttribution call site (routes/ingest.ts extracts the values out of
 * `meta` first; see meta-sanitizer.ts's extractAttribution).
 *
 * Each field's update is guarded by `<field>: null` in the WHERE clause, not
 * just an in-memory null check on an already-read Visit object — that is
 * what makes this race-safe. Two concurrent batches racing to be first with
 * a value both pass the in-memory check, but only one write can match `id`
 * AND `<field>: null` at the DB — the loser's updateMany matches zero rows
 * and silently no-ops instead of clobbering the winner. Getting this wrong
 * (unconditional overwrite) would corrupt first-touch attribution.
 */
export async function applyAttribution(visitId: string, attr: Attribution): Promise<void> {
  if (attr.from) {
    await prisma.visit.updateMany({ where: { id: visitId, from: null }, data: { from: attr.from } });
  }
  if (attr.ref) {
    await prisma.visit.updateMany({ where: { id: visitId, ref: null }, data: { ref: attr.ref } });
  }
  if (attr.theme) {
    await prisma.visit.updateMany({ where: { id: visitId, theme: null }, data: { theme: attr.theme } });
  }
}
