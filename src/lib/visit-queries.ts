import { type Event, type Site, type Visit } from "@prisma/client";
import { prisma } from "../db";
import { madridDayBounds } from "./madrid";

// Read-only query layer for the admin pages (routes/home.ts,
// routes/visit-detail.ts).
//
// The dashboard is deliberately filter-free and chart-free. The summary
// strip counts the CURRENT MADRID CALENDAR DAY (00:00–23:59, Europe/Madrid)
// — visits, events, identified emails — plus "Live" (activity in the last
// few minutes). The visit list below shows every visit for the site,
// newest-active first, with no app/client/date/email/meta filtering and no
// top rankings. The one remaining knob is the site switcher in the topbar.

const PAGE_SIZE = 30;
// "Live" = visits that saw an event in the last 5 minutes.
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
  /** Denormalized latest meta snapshot (Visit.meta, jsonb). Coerced in the view. */
  meta: unknown;
  /** How many anonymous rows were folded into this one. */
  mergeCount: number;
  /** Event count for this visit (lateral aggregate below). */
  eventCount: number;
  /** Distinct pages visited (lateral aggregate below). */
  pageCount: number;
  /** Page of the FIRST event (lateral aggregate below). */
  firstPage: string | null;
  /** Page of the most recent event (lateral aggregate below). */
  lastPage: string | null;
}

export async function listSites(): Promise<Site[]> {
  return prisma.site.findMany({ orderBy: { id: "asc" } });
}

/** Every visit for a site, newest-active-first, offset-paginated (30/page),
 *  no filters — every client kind (human/search/ai/bot) is shown. `hasNext`
 *  comes from fetching one row past the page size rather than a COUNT(*).
 *
 *  Each row is enriched with event/page aggregates via a LATERAL join — one
 *  extra lookup per row, kept cheap by the Event `(visitId, at)` index. */
export async function listVisits(
  siteId: string,
  page: number,
): Promise<{ items: VisitListItem[]; hasNext: boolean }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const rows = await prisma.$queryRaw<VisitListItem[]>`
    SELECT
      v.id, v."siteId", v."firstAt", v."lastAt", v.device, v.os,
      v.country, v.region, v.city, v.lang, v.email, v.theme, v.from, v.ref, v.app,
      v."client", v."meta", v."mergeCount",
      e."eventCount", e."pageCount", e."firstPage", e."lastPage"
    FROM "Visit" v
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "eventCount",
             count(DISTINCT "page")::int AS "pageCount",
             (array_agg("page" ORDER BY at ASC))[1] AS "firstPage",
             (array_agg("page" ORDER BY at DESC))[1] AS "lastPage"
      FROM "Event"
      WHERE "visitId" = v.id
    ) e ON true
    WHERE v."siteId" = ${siteId}
    ORDER BY v."lastAt" DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `;
  const hasNext = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  return { items, hasNext };
}

export async function getVisitDetail(id: string): Promise<{ visit: Visit; events: Event[] } | null> {
  const visit = await prisma.visit.findUnique({ where: { id } });
  if (!visit) return null;
  const events = await prisma.event.findMany({ where: { visitId: id }, orderBy: { at: "asc" } });
  return { visit, events };
}

/** Site-level numeric summary for the dashboard header. Deliberately NOT
 *  chart data — four scalar counts, deliberately timezone-aware: visits /
 *  events / identified are all counted over the current Madrid calendar day
 *  (00:00–23:59 Europe/Madrid), and live-now is a rolling 5-minute window. */
export interface SiteSummary {
  visitsToday: number;
  eventsToday: number;
  emailsToday: number;
  liveNow: number;
}

interface SummaryRow {
  visitsToday: number;
  eventsToday: number;
  emailsToday: number;
  liveNow: number;
}

export async function getSiteSummary(siteId: string, now: Date): Promise<SiteSummary> {
  const { start, end } = madridDayBounds(now);
  const liveSince = new Date(now.getTime() - LIVE_WINDOW_MS);
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      (SELECT count(*)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND v."firstAt" >= ${start} AND v."firstAt" < ${end}) AS "visitsToday",
      (SELECT count(*)::int FROM "Event" e JOIN "Visit" v ON v.id = e."visitId"
         WHERE v."siteId" = ${siteId} AND e.at >= ${start} AND e.at < ${end}) AS "eventsToday",
      (SELECT count(DISTINCT email)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND v.email IS NOT NULL
           AND v."firstAt" >= ${start} AND v."firstAt" < ${end}) AS "emailsToday",
      (SELECT count(*)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND v."lastAt" >= ${liveSince}) AS "liveNow"
  `;
  return rows[0] ?? { visitsToday: 0, eventsToday: 0, emailsToday: 0, liveNow: 0 };
}
