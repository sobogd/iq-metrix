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
  /** 'human' (default) | 'search' | 'ai' | 'bot' | 'all'. */
  client: string;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  email: string;
  metaKey: string;
  metaValue: string;
}

export interface VisitFilters {
  siteId: string;
  app: string | null;
  client: string;
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
    client: q.client || "human",
    from: parseDay(q.from),
    to: parseDayEnd(q.to),
    email: q.email || null,
    metaKey: q.metaKey || null,
    metaValue: q.metaValue || null,
  };
}

/** SQL predicate for the client-classification filter. `alias` is a fixed
 *  identifier this module controls (never user input). 'human' also admits
 *  NULL (legacy/imported rows predate the column); 'all' matches everything. */
function clientPredicate(alias: string, client: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  if (client === "human") return Prisma.sql`(${a}."client" IS NULL OR ${a}."client" = 'human')`;
  if (client === "search" || client === "ai" || client === "bot") return Prisma.sql`${a}."client" = ${client}`;
  return Prisma.sql`TRUE`;
}

/** WHERE conditions shared by the visit list and its aggregates. `alias` is
 *  a fixed identifier this module controls (never user input), injected via
 *  Prisma.raw — the only thing that makes that safe. */
function visitConditions(f: VisitFilters, alias: string): Prisma.Sql[] {
  const a = Prisma.raw(alias);
  const cond: Prisma.Sql[] = [Prisma.sql`${a}."siteId" = ${f.siteId}`];
  if (f.app) cond.push(Prisma.sql`${a}."app" = ${f.app}`);
  cond.push(clientPredicate(alias, f.client));
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

/** Page of visits for the given filters, newest-active-first. Offset
 *  pagination (not cursor/keyset) — simpler to reason about and this is an
 *  admin-only, low-volume list; a real product at scale would want keyset
 *  pagination on (lastAt, id) instead. `hasNext` comes from fetching one row
 *  past the page size rather than a separate COUNT(*).
 *
 *  Each row is enriched with event/page aggregates via a LATERAL join — one
 *  extra lookup per row, kept cheap by the Event `(visitId, at)` index. */
export async function listVisits(
  filters: VisitFilters,
  page: number,
): Promise<{ items: VisitListItem[]; hasNext: boolean }> {
  const where = whereSql(visitConditions(filters, "v"));
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

/** Site-level numeric summary for the dashboard header. Deliberately NOT
 *  chart data — four scalar counts, rolling windows, timezone-free, scoped to
 *  the selected client lens. */
export interface SiteSummary {
  visits24h: number;
  events24h: number;
  emails7d: number;
  liveNow: number;
}

interface SummaryRow {
  visits24h: number;
  events24h: number;
  emails7d: number;
  liveNow: number;
}

export async function getSiteSummary(siteId: string, client: string, now: Date): Promise<SiteSummary> {
  const d24 = new Date(now.getTime() - 24 * 3600_000);
  const d7 = new Date(now.getTime() - 7 * 24 * 3600_000);
  const d5 = new Date(now.getTime() - 5 * 60_000);
  const c = clientPredicate("v", client);
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      (SELECT count(*)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND v."firstAt" >= ${d24} AND ${c}) AS "visits24h",
      (SELECT count(*)::int FROM "Event" e JOIN "Visit" v ON v.id = e."visitId"
         WHERE v."siteId" = ${siteId} AND e.at >= ${d24} AND ${c}) AS "events24h",
      (SELECT count(DISTINCT email)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND email IS NOT NULL AND v."firstAt" >= ${d7} AND ${c}) AS "emails7d",
      (SELECT count(*)::int FROM "Visit" v
         WHERE v."siteId" = ${siteId} AND v."lastAt" >= ${d5} AND ${c}) AS "liveNow"
  `;
  return rows[0] ?? { visits24h: 0, events24h: 0, emails7d: 0, liveNow: 0 };
}

/** A ranked breakdown entry, e.g. "Pricing" → 214. Rendered as a plain list,
 *  not a chart (this panel is deliberately chart-free). */
export interface RankedItem {
  label: string;
  count: number;
}

export async function getTopPages(siteId: string, client: string, now: Date): Promise<RankedItem[]> {
  const d7 = new Date(now.getTime() - 7 * 24 * 3600_000);
  const c = clientPredicate("v", client);
  const rows = await prisma.$queryRaw<Array<{ page: string; cnt: number }>>`
    SELECT e.page, count(*)::int AS cnt
    FROM "Event" e
    JOIN "Visit" v ON v.id = e."visitId"
    WHERE v."siteId" = ${siteId} AND e.at >= ${d7} AND ${c}
    GROUP BY e.page
    ORDER BY cnt DESC, e.page ASC
    LIMIT 8
  `;
  return rows.map((r) => ({ label: r.page, count: r.cnt }));
}

export async function getTopCountries(siteId: string, client: string, now: Date): Promise<RankedItem[]> {
  const d7 = new Date(now.getTime() - 7 * 24 * 3600_000);
  const c = clientPredicate("v", client);
  const rows = await prisma.$queryRaw<Array<{ country: string; cnt: number }>>`
    SELECT v.country, count(*)::int AS cnt
    FROM "Visit" v
    WHERE v."siteId" = ${siteId} AND v."firstAt" >= ${d7} AND ${c}
    GROUP BY v.country
    ORDER BY cnt DESC, v.country ASC
    LIMIT 8
  `;
  return rows.map((r) => ({ label: r.country, count: r.cnt }));
}
