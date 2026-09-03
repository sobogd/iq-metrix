import { Prisma, type Event, type Site, type Visit } from "@prisma/client";
import { prisma } from "../db";

// Read-only query layer for the admin visit list / detail pages
// (routes/home.ts, routes/visit-detail.ts). Raw SQL, not the Prisma model
// API, for the visit list and its aggregates specifically: the meta filter
// needs `meta->>'key'` (not Prisma's JSON path filter, which compiles to a
// different SQL expression — `#>>` over a path array — that is not
// guaranteed to match the hand-written expression index in
// prisma/migrations/**/migration.sql). Raw SQL guarantees the exact
// expression the index was built for.

const PAGE_SIZE = 30;

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
  theme: string | null;
  from: string | null;
  ref: string | null;
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
  const rows = await prisma.$queryRaw<VisitListItem[]>`
    SELECT
      v.id, v."siteId", v."firstAt", v."lastAt", v.device, v.os,
      v.country, v.region, v.city, v.email, v.theme, v.from, v.ref
    FROM "Visit" v
    WHERE ${where}
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

