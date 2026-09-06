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

// "Live" = visits that saw an event in the last 5 minutes. Only meaningful
// for the current day — the route computes it solely when day == today.
const LIVE_WINDOW_MS = 5 * 60_000;

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
  /** First page of the visit — its concrete pathname ("/", "/ru/feature-slug")
   *  when the events carry one, else the coarse `page` label (events ingested
   *  before path capture). Rendered as the row's entry-page chip. */
  firstPage: string | null;
  /** Last page of the visit, in the same path ?? label form. */
  lastPage: string | null;
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
 *  extra lookup per row, kept cheap by the Event `(visitId, at)` index. */
export async function listVisits(siteId: string, start: Date, end: Date): Promise<VisitListItem[]> {
  return prisma.$queryRaw<VisitListItem[]>`
    SELECT
      v.id, v."siteId", v."firstAt", v."lastAt", v.device, v.os,
      v.country, v.region, v.city, v.lang, v.email, v.theme, v.from, v.ref, v.app,
      v."client", v."clientReason", v."meta", v."mergeCount",
      e."eventCount", e."pageCount", e."firstPage", e."lastPage"
    FROM "Visit" v
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "eventCount",
             count(DISTINCT "page")::int AS "pageCount",
             (array_agg(coalesce("path", "page") ORDER BY at ASC))[1] AS "firstPage",
             (array_agg(coalesce("path", "page") ORDER BY at DESC))[1] AS "lastPage"
      FROM "Event"
      WHERE "visitId" = v.id
    ) e ON true
    WHERE v."siteId" = ${siteId}
      AND v."firstAt" < ${end}
      AND v."lastAt" >= ${start}
    ORDER BY v."lastAt" DESC
  `;
}

export async function getVisitDetail(id: string): Promise<{ visit: Visit; events: Event[] } | null> {
  const visit = await prisma.visit.findUnique({ where: { id } });
  if (!visit) return null;
  const events = await prisma.event.findMany({ where: { visitId: id }, orderBy: { at: "asc" } });
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
 *  among those sessions. "Live" is NOT part of this — it only means something
 *  for the current day, so the route computes it separately (getLiveNow)
 *  and the view drops the card for any other day. */
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

/** Count of visits that saw an event in the last 5 minutes ("Live"). */
export async function getLiveNow(siteId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - LIVE_WINDOW_MS);
  const rows = await prisma.$queryRaw<{ live: number }[]>`
    SELECT count(*)::int AS live FROM "Visit" v
    WHERE v."siteId" = ${siteId} AND v."lastAt" >= ${since}
  `;
  return rows[0]?.live ?? 0;
}
