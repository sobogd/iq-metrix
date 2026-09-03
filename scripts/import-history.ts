/**
 * One-time backfill from iq-rest's / translator's OWN analytics-v2 tables
 * into this service's Visit/Event. Standalone: run via `npx tsx
 * scripts/import-history.ts --site=iq-rest|iq-translate`, never wired into
 * the server, any npm script, or CI.
 *
 * Not run against prod here — verified only against the two products' local
 * dev Postgres databases (see README's "before running" note). At actual
 * cutover time this same script points at their prod DBs instead, via
 * SOURCE_DATABASE_URL; nothing about that is exercised by this task.
 *
 * Deliberately reads the source tables with a plain `pg` client and raw SQL
 * against their known, stable table/column shapes (sessions_new / events_new
 * / users) instead of pulling in either product's own Prisma client or
 * schema — this script has no business depending on either product's build,
 * and the two source shapes are simple enough that raw SQL is the smaller
 * footprint. Writes go through this repo's own Prisma client/schema, same as
 * every other write path in this service.
 */
import { Client } from "pg";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";

const BATCH_SIZE = 1000;

type SiteArg = "iq-rest" | "iq-translate";

// Local-dev-only conveniences, exactly what the task handed over (iq-rest)
// or what translator/.env.local's own DATABASE_URL says (translator) at the
// time this script was written. SOURCE_DATABASE_URL always overrides —
// never hardcode a prod connection string here; the cutover run must set it
// explicitly.
const DEFAULT_SOURCE_URLS: Record<SiteArg, string> = {
  "iq-rest": "postgresql://sobogd@localhost:5432/iq_rest",
  "iq-translate": "postgresql://postgres:postgres@localhost:5432/translator",
};

interface SourceVisitRow {
  id: string;
  visitKey: string;
  hash: string;
  firstAt: Date;
  lastAt: Date;
  device: string | null;
  os: string | null;
  country: string;
  region: string;
  city: string;
  lang: string | null;
  theme: string | null;
  from: string | null;
  ref: string | null;
  email: string | null;
  mergeCount: number;
}

interface SourceEventRow {
  id: string;
  sessionId: string;
  page: string;
  action: string;
  name: string;
  locale: string | null;
  at: Date;
  metaKeyValue: string | null; // restaurantId or topicId, whichever the site has
}

function parseArgs(argv: string[]): { site: SiteArg } {
  const arg = argv.find((a) => a.startsWith("--site="));
  const value = arg?.slice("--site=".length);
  if (value !== "iq-rest" && value !== "iq-translate") {
    throw new Error('usage: tsx scripts/import-history.ts --site=iq-rest|iq-translate');
  }
  return { site: value };
}

/** iq-rest joins users for email (sessions_new.userId -> users.id, null join
 *  = anonymous visit); translator's sessions_new already carries email
 *  directly. Both other columns match 1:1 across the two schemas. */
async function fetchVisits(source: Client, site: SiteArg): Promise<SourceVisitRow[]> {
  const sql =
    site === "iq-rest"
      ? `SELECT
           s.id, s."visitKey", s.hash, s."firstAt", s."lastAt", s.device, s.os,
           s.country, s.region, s.city, s.lang, s.theme, s.from, s.ref,
           u.email, s."mergeCount"
         FROM sessions_new s
         LEFT JOIN users u ON s."userId" = u.id
         ORDER BY s."firstAt" ASC`
      : `SELECT
           id, "visitKey", hash, "firstAt", "lastAt", device, os,
           country, region, city, lang, theme, "from", "ref",
           email, "mergeCount"
         FROM sessions_new
         ORDER BY "firstAt" ASC`;
  const result = await source.query<SourceVisitRow>(sql);
  return result.rows;
}

/** iq-rest's events_new carries restaurantId; translator's carries topicId.
 *  Either way it becomes this one event's `meta: { <key>: value }` — null
 *  when the source column is null (most rows; see README for the local
 *  counts this was checked against). */
async function fetchEvents(source: Client, site: SiteArg): Promise<SourceEventRow[]> {
  const metaColumn = site === "iq-rest" ? "restaurantId" : "topicId";
  const sql = `SELECT
      id, "sessionId", page, action, name, locale, at, "${metaColumn}" AS "metaKeyValue"
    FROM events_new
    ORDER BY at ASC`;
  const result = await source.query<SourceEventRow>(sql);
  return result.rows;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function importVisits(site: SiteArg, rows: SourceVisitRow[]): Promise<number> {
  let imported = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const data: Prisma.VisitCreateManyInput[] = batch.map((r) => ({
      // Same id/visitKey as the source row — see the file header: this is
      // what makes a rerun idempotent via skipDuplicates below (a visitKey
      // that already exists under this siteId is silently skipped, and so
      // is an id that already exists), and it makes each event's sessionId
      // map onto the matching Visit.id with no lookup table to build.
      id: r.id,
      siteId: site,
      visitKey: r.visitKey,
      hash: r.hash,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      device: r.device,
      os: r.os,
      country: r.country,
      region: r.region,
      city: r.city,
      lang: r.lang,
      theme: r.theme,
      from: r.from,
      ref: r.ref,
      email: r.email,
      // No equivalent in the old per-product schema (a single-app service
      // had no "which sub-app" concept) — expected to be null for every
      // imported row.
      app: null,
      // No visit-level custom-field snapshot existed in the old schema
      // either (only per-event restaurantId/topicId) — imported visits
      // start with an empty snapshot; only their events carry meta.
      meta: {},
      mergeCount: r.mergeCount,
    }));
    const result = await prisma.visit.createMany({ data, skipDuplicates: true });
    imported += result.count;
  }
  return imported;
}

async function importEvents(rows: SourceEventRow[], metaKey: "restaurantId" | "topicId"): Promise<number> {
  let imported = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const data: Prisma.EventCreateManyInput[] = batch.map((r) => ({
      id: r.id,
      visitId: r.sessionId,
      page: r.page,
      action: r.action,
      name: r.name,
      locale: r.locale,
      app: null,
      meta: r.metaKeyValue ? { [metaKey]: r.metaKeyValue } : {},
      at: r.at,
    }));
    const result = await prisma.event.createMany({ data, skipDuplicates: true });
    imported += result.count;
  }
  return imported;
}

async function main(): Promise<void> {
  const { site } = parseArgs(process.argv.slice(2));
  const sourceUrl = process.env.SOURCE_DATABASE_URL || DEFAULT_SOURCE_URLS[site];
  const metaKey = site === "iq-rest" ? "restaurantId" : "topicId";

  console.log(`importing history for site="${site}" from ${maskPassword(sourceUrl)}`);

  const existingSite = await prisma.site.findUnique({ where: { id: site } });
  if (!existingSite) {
    throw new Error(`Site "${site}" does not exist in this service's DB yet — run "npx prisma db seed" first.`);
  }

  const source = new Client({ connectionString: sourceUrl });
  await source.connect();
  try {
    const visitRows = await fetchVisits(source, site);
    const eventRows = await fetchEvents(source, site);
    console.log(`source has ${visitRows.length} sessions_new, ${eventRows.length} events_new rows`);

    const visitsImported = await importVisits(site, visitRows);
    const eventsImported = await importEvents(eventRows, metaKey);

    console.log(
      `done: ${visitsImported}/${visitRows.length} visits inserted, ${eventsImported}/${eventRows.length} events inserted ` +
        `(the rest were already present — skipDuplicates on siteId+visitKey / id, safe to rerun)`,
    );
  } finally {
    await source.end();
  }
}

function maskPassword(url: string): string {
  return url.replace(/:\/\/([^:/]+):([^@/]+)@/, "://$1:***@");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
