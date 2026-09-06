import { type Event, type Site, type Visit } from "@prisma/client";
import { prisma } from "../db";

// Query layer for the admin pages (routes/home.ts, routes/visit-detail.ts)
// plus the one admin mutation the UI offers — the per-session delete.
//
// The dashboard is deliberately filter-free and chart-free, scoped to ONE
// Madrid calendar day chosen in the header: the summary strip counts that
// day (visits / events / identified emails), and the list below it shows
// every session that had any activity during it, newest-active first — no
// pagination. "A session was active on the day" means its window overlaps
// the day (firstAt < day-end AND lastAt ≥ day-start): a session that started
// yesterday 23:55 and kept firing until 00:05 is on yesterday's list AND
// today's, which is exactly what "everything that happened that day" wants.

// "New" is a row-level flag: the visit has ≥ 1 event the admin has not seen
// yet (Event.seen = false). The sessions list marks the events of every
// session it returns as seen right after the SELECT (markVisitsSeen), so a
// session's green dot shows on the first load after its events arrived and
// clears on the next — until genuinely new events land.

export interface VisitListItem {
  id: string;
  siteId: string;
  firstAt: Date;
  lastAt: Date;
  device: string | null;
  os: string | null;
  country: string;
  region: string;
  city: string;
  lang: string | null;
  email: string | null;
  theme: string | null;
  from: string | null;
  ref: string | null;
  app: string | null;
  client: string | null;
  /** Why `client` got that label ("token:gptbot", "dns:googlebot.com", …) —
   *  the tooltip on the non-human pill. */
  clientReason: string | null;
  /** Denormalized latest meta snapshot (Visit.meta, jsonb). Coerced in the view. */
  meta: unknown;
  /** How many anonymous rows were folded into this one. */
  mergeCount: number;
  /** Event count for this visit (lateral aggregate below). */
  eventCount: number;
  /** Distinct pages visited (lateral aggregate below). */
  pageCount: number;
  /** First page of the visit — its concrete pathname ("/", "/ru/feature-slug").
   *  Null when the visit predates path capture (or was server-fired without a
   *  page): the list then shows no address line rather than a bare type. */
  firstPage: string | null;
  /** Last page of the visit, as its pathname — null for pre-path sessions. */
  lastPage: string | null;
  /** True when the visit has events the admin has not seen yet (Event.seen =
   *  false) — the row shows the green "new" dot. */
  new: boolean;
}

export async function listSites(): Promise<Site[]> {
  return prisma.site.findMany({ orderBy: { id: "asc" } });
}

/** Every session with activity inside [start, end) for a site (the day chosen
 *  in the header), newest-active first. No filters, no pagination — the list
 *  IS the day, and a Madrid day rarely holds more than a few dozen sessions;
 *  the day bounds keep the scan on the (siteId, lastAt) index.
 *
 *  Each row is enriched with event/page aggregates via a LATERAL join — one
 *  extra lookup per row, kept cheap by the Event `(visitId, at)` index. The
 *  `new` flag is an EXISTS over the same index for any unseen event. */
export async function listVisits(siteId: string, start: Date, end: Date): Promise<VisitListItem[]> {
  return prisma.$queryRaw<VisitListItem[]>`
    SELECT
      v.id, v."siteId", v."firstAt", v."lastAt", v.device, v.os,
      v.country, v.region, v.city, v.lang, v.email, v.theme, v.from, v.ref, v.app,
      v."client", v."clientReason", v."meta", v."mergeCount",
      e."eventCount", e."pageCount", e."firstPage", e."lastPage",
      EXISTS (
        SELECT 1 FROM "Event" ev
        WHERE ev."visitId" = v.id AND ev."seen" = false
      ) AS "new"
    FROM "Visit" v
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "eventCount",
             count(DISTINCT "page")::int AS "pageCount",
             (array_agg("path" ORDER BY at ASC))[1] AS "firstPage",
             (array_agg("path" ORDER BY at DESC))[1] AS "lastPage"
      FROM "Event"
      WHERE "visitId" = v.id
    ) e ON true
    WHERE v."siteId" = ${siteId}
      AND v."firstAt" < ${end}
      AND v."lastAt" >= ${start}
    ORDER BY v."lastAt" DESC
  `;
}

/** Mark a session's events as seen — called after the sessions list returned
 *  the session (its whole event set counts as displayed, so viewing a session
 *  anywhere acknowledges all of it). */
export async function markVisitsSeen(visitIds: string[]): Promise<void> {
  if (visitIds.length === 0) return;
  await prisma.event.updateMany({
    where: { visitId: { in: visitIds }, seen: false },
    data: { seen: true },
  });
}

/** Mark one session's events as seen — after the visit-detail page rendered
 *  them (viewing the session directly acknowledges it too). */
export async function markVisitSeen(visitId: string): Promise<void> {
  await prisma.event.updateMany({ where: { visitId, seen: false }, data: { seen: true } });
}

export async function getVisitDetail(id: string): Promise<{ visit: Visit; events: Event[] } | null> {
  const visit = await prisma.visit.findUnique({ where: { id } });
  if (!visit) return null;
  // Newest event first — the detail page renders the stream top-down.
  const events = await prisma.event.findMany({ where: { visitId: id }, orderBy: { at: "desc" } });
  return { visit, events };
}

/** Permanently deletes one session (a Visit row). Its Event rows go with it
 *  via the FK cascade — `Event_visitId_fkey` is ON DELETE CASCADE in the
 *  initial migration, so a single delete removes the whole session. Returns
 *  the deleted visit's siteId (so the caller can redirect back to the right
 *  site's list), or null when no such visit exists — e.g. a raced double
 *  submit of the delete form. */
export async function deleteVisit(id: string): Promise<string | null> {
  const visit = await prisma.visit.findUnique({ where: { id }, select: { siteId: true } });
  if (!visit) return null;
  // deleteMany (not delete) so a visit vanishing between the lookup and here
  // (double submit / someone else deleting) no-ops instead of throwing P2025.
  await prisma.visit.deleteMany({ where: { id } });
  return visit.siteId;
}

/** Site-level numeric summary for the selected Madrid day. Deliberately NOT
 *  chart data — three scalar counts over the day the header navigates
 *  (00:00–23:59 Europe/Madrid): visits (sessions with any activity that day),
 *  events (rows with `at` inside the day) and distinct identified emails
 *  among those sessions. There is no "live" number — liveness is per-row, on
 *  the sessions list (VisitListItem.live). */
export interface DaySummary {
  visits: number;
  events: number;
  emails: number;
}

interface SummaryRow {
  visits: number;
  events: number;
  emails: number;
}

export async function getDaySummary(siteId: string, start: Date, end: Date): Promise<DaySummary> {
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      (SELECT count(*)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId}
           AND v."firstAt" < ${end} AND v."lastAt" >= ${start}) AS visits,
      (SELECT count(*)::int FROM "Event" e JOIN "Visit" v ON v.id = e."visitId"
         WHERE v."siteId" = ${siteId} AND e.at >= ${start} AND e.at < ${end}) AS events,
      (SELECT count(DISTINCT email)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId}
           AND v."firstAt" < ${end} AND v."lastAt" >= ${start}
           AND v.email IS NOT NULL) AS emails
  `;
  return rows[0] ?? { visits: 0, events: 0, emails: 0 };
}
