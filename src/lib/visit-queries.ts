import { Prisma, type Event, type Site, type Visit } from "@prisma/client";
import { prisma } from "../db";
import { coerceMeta } from "../views/format";

// Read-only query layer for the admin visit list / detail pages
// (routes/home.ts, routes/visit-detail.ts). Raw SQL, not the Prisma model
// API, for the visit list and its aggregates specifically: the meta filter
// needs `meta->>'key'` (not Prisma's JSON path filter, which compiles to a
// different SQL expression — `#>>` over a path array — that is not
// guaranteed to match the hand-written expression index in
// prisma/migrations/**/migration.sql). Raw SQL guarantees the exact
// expression the index was built for.

const PAGE_SIZE = 30;
const CHART_LIMIT = 8;
const CHART_DAYS = 30;

/** Filter state as read off the querystring — everything a string (or
 *  empty string for "unset"), because that's what an HTML form/query param
 *  gives you and it's also exactly what's needed to re-populate the filter
 *  form's `value=` attributes. routes/home.ts builds this; toVisitFilters
 *  below converts it into the typed shape the queries need. */
export interface QueryFilters {
  site: string;
  app: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  email: string;
  metaKey: string;
  metaValue: string;
}

export interface VisitFilters {
  siteId: string;
  app: string | null;
  from: Date | null;
  to: Date | null;
  email: string | null;
  metaKey: string | null;
  metaValue: string | null;
}

function parseDay(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `to` is a calendar day from a date input — inclusive means "through the
 *  end of that day", not midnight at its start. */
function parseDayEnd(raw: string): Date | null {
  const start = parseDay(raw);
  if (!start) return null;
  return new Date(start.getTime() + 86_400_000 - 1);
}

export function toVisitFilters(q: QueryFilters): VisitFilters {
  return {
    siteId: q.site,
    app: q.app || null,
    from: parseDay(q.from),
    to: parseDayEnd(q.to),
    email: q.email || null,
    metaKey: q.metaKey || null,
    metaValue: q.metaValue || null,
  };
}

/** WHERE conditions shared by the visit list and every chart aggregate.
 *  `alias` is a fixed identifier this module controls (never user input),
 *  injected via Prisma.raw — the only thing that makes that safe. */
function visitConditions(f: VisitFilters, alias: string): Prisma.Sql[] {
  const a = Prisma.raw(alias);
  const cond: Prisma.Sql[] = [Prisma.sql`${a}."siteId" = ${f.siteId}`];
  if (f.app) cond.push(Prisma.sql`${a}."app" = ${f.app}`);
  if (f.from) cond.push(Prisma.sql`${a}."firstAt" >= ${f.from}`);
  if (f.to) cond.push(Prisma.sql`${a}."firstAt" <= ${f.to}`);
  if (f.email) cond.push(Prisma.sql`${a}."email" ILIKE ${`%${f.email}%`}`);
  // The one free meta.<key>=<value> filter. `->>'` with the key bound as a
  // parameter (not string-concatenated) both hits the expression index when
  // key = 'restaurantId' and is injection-safe for any other key.
  if (f.metaKey && f.metaValue) cond.push(Prisma.sql`${a}."meta" ->> ${f.metaKey} = ${f.metaValue}`);
  return cond;
}

function whereSql(conditions: Prisma.Sql[]): Prisma.Sql {
  return Prisma.join(conditions, " AND ");
}

export async function listSites(): Promise<Site[]> {
  return prisma.site.findMany({ orderBy: { id: "asc" } });
}

export async function getSiteById(id: string): Promise<Site | null> {
  return prisma.site.findUnique({ where: { id } });
}

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
  email: string | null;
  app: string | null;
  meta: Record<string, string>;
  eventCount: number;
  firstPage: string | null;
}

interface RawVisitListRow {
  id: string;
  siteId: string;
  firstAt: Date;
  lastAt: Date;
  device: string | null;
  os: string | null;
  country: string;
  region: string;
  city: string;
  email: string | null;
  app: string | null;
  meta: unknown;
  eventCount: number;
  firstPage: string | null;
}

/** Page of visits for the given filters, newest-active-first. Offset
 *  pagination (not cursor/keyset) — simpler to reason about and this is an
 *  admin-only, low-volume list; a real product at scale would want keyset
 *  pagination on (lastAt, id) instead. `hasNext` comes from fetching one row
 *  past the page size rather than a separate COUNT(*) — cheap and avoids a
 *  full-table count. */
export async function listVisits(
  filters: VisitFilters,
  page: number,
): Promise<{ items: VisitListItem[]; hasNext: boolean }> {
  const where = whereSql(visitConditions(filters, "v"));
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const rows = await prisma.$queryRaw<RawVisitListRow[]>`
    SELECT
      v.id, v."siteId", v."firstAt", v."lastAt", v.device, v.os,
      v.country, v.region, v.city, v.email, v.app, v.meta,
      (SELECT COUNT(*)::int FROM "Event" e WHERE e."visitId" = v.id) AS "eventCount",
      (SELECT e2.page FROM "Event" e2 WHERE e2."visitId" = v.id ORDER BY e2.at ASC LIMIT 1) AS "firstPage"
    FROM "Visit" v
    WHERE ${where}
    ORDER BY v."lastAt" DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `;
  const hasNext = rows.length > PAGE_SIZE;
  const items: VisitListItem[] = rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, meta: coerceMeta(r.meta) }));
  return { items, hasNext };
}

export async function getVisitDetail(id: string): Promise<{ visit: Visit; events: Event[] } | null> {
  const visit = await prisma.visit.findUnique({ where: { id } });
  if (!visit) return null;
  const events = await prisma.event.findMany({ where: { visitId: id }, orderBy: { at: "asc" } });
  return { visit, events };
}

export interface ChartPoint {
  label: string;
  value: number;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDay(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(d);
}

/** Fixed rolling 30-day window, per the task spec — deliberately NOT the
 *  from/to date-range filter (that would make "last 30 days" a lie the
 *  moment someone picks a different range). Still respects site/app/email/
 *  meta, same as the other charts. */
export async function visitsPerDay(filters: VisitFilters): Promise<ChartPoint[]> {
  const since = new Date(Date.now() - CHART_DAYS * 86_400_000);
  const conditions = visitConditions(filters, "v");
  conditions.push(Prisma.sql`v."firstAt" >= ${since}`);
  const rows = await prisma.$queryRaw<{ day: Date; n: number }[]>`
    SELECT date_trunc('day', v."firstAt") AS day, COUNT(*)::int AS n
    FROM "Visit" v
    WHERE ${whereSql(conditions)}
    GROUP BY 1
    ORDER BY 1
  `;
  const byDay = new Map(rows.map((r) => [isoDay(r.day), r.n]));
  const points: ChartPoint[] = [];
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    points.push({ label: shortDay(d), value: byDay.get(isoDay(d)) ?? 0 });
  }
  return points;
}

export async function topCountries(filters: VisitFilters): Promise<ChartPoint[]> {
  const rows = await prisma.$queryRaw<{ country: string; n: number }[]>`
    SELECT v.country, COUNT(*)::int AS n
    FROM "Visit" v
    WHERE ${whereSql(visitConditions(filters, "v"))}
    GROUP BY 1 ORDER BY n DESC LIMIT ${CHART_LIMIT}
  `;
  return rows.map((r) => ({ label: r.country, value: r.n }));
}

export async function deviceBreakdown(filters: VisitFilters): Promise<ChartPoint[]> {
  const rows = await prisma.$queryRaw<{ device: string; n: number }[]>`
    SELECT COALESCE(v.device, 'unknown') AS device, COUNT(*)::int AS n
    FROM "Visit" v
    WHERE ${whereSql(visitConditions(filters, "v"))}
    GROUP BY 1 ORDER BY n DESC
  `;
  return rows.map((r) => ({ label: r.device, value: r.n }));
}

export async function topPages(filters: VisitFilters): Promise<ChartPoint[]> {
  const rows = await prisma.$queryRaw<{ page: string; n: number }[]>`
    SELECT e.page, COUNT(*)::int AS n
    FROM "Event" e
    JOIN "Visit" v ON v.id = e."visitId"
    WHERE ${whereSql(visitConditions(filters, "v"))}
    GROUP BY e.page ORDER BY n DESC LIMIT ${CHART_LIMIT}
  `;
  return rows.map((r) => ({ label: r.page, value: r.n }));
}
