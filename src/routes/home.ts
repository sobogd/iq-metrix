import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import {
  getSiteSummary,
  getTopCountries,
  getTopPages,
  listSites,
  listVisits,
  toVisitFilters,
  type QueryFilters,
} from "../lib/visit-queries";
import { renderNoSitesPage, renderVisitListPage } from "../views/visit-list-page";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** yyyy-mm-dd in UTC — matches the list filter's parseDay (also UTC). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Accepts either shape: a literal `meta.<key>=<value>` query param (the
 *  canonical, bookmarkable/shareable form — also what pagination links on
 *  this page emit, see visit-list-page.ts's buildLink), or the `metaKey`+
 *  `metaValue` pair the filter form itself actually submits (a plain
 *  <select>+<input> can't rename its `name` to a dynamic `meta.<key>`
 *  without client JS, which this app deliberately has none of). */
function parseMetaFilter(query: Record<string, unknown>): { key: string; value: string } | null {
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith("meta.") && typeof v === "string" && v) {
      const key = k.slice("meta.".length);
      if (key) return { key, value: v };
    }
  }
  const metaKey = str(query.metaKey);
  const metaValue = str(query.metaValue);
  if (metaKey && metaValue) return { key: metaKey, value: metaValue };
  return null;
}

export async function homeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const sites = await listSites();
    reply.type("text/html; charset=utf-8");
    if (sites.length === 0) return reply.send(renderNoSitesPage());

    const q = request.query as Record<string, unknown>;
    const requestedSite = str(q.site);
    const currentSite = sites.find((s) => s.id === requestedSite) ?? sites[0]!;
    const meta = parseMetaFilter(q);
    const page = Math.max(1, Number.parseInt(str(q.page), 10) || 1);

    const raw: QueryFilters = {
      site: currentSite.id,
      app: str(q.app),
      // Default lens is 'human' (real visitors); crawlers/AI are opt-in via
      // the Client filter so existing metrics don't jump on deploy.
      client: str(q.client) || "human",
      from: str(q.from),
      to: str(q.to),
      email: str(q.email),
      metaKey: meta?.key ?? "",
      metaValue: meta?.value ?? "",
    };

    // Date preset (1d/7d/30d): applied only when no explicit from/to was
    // typed. Sets `from` to "N days ago" and leaves `to` open, so the list
    // shows every visit since then.
    let rangeDays = 0;
    if (!raw.from && !raw.to) {
      const r = Number.parseInt(str(q.range), 10);
      if (r === 1 || r === 7 || r === 30) rangeDays = r;
    }
    if (rangeDays) {
      raw.from = isoDay(new Date(Date.now() - rangeDays * 86_400_000));
    }

    const filters = toVisitFilters(raw);
    const now = new Date();
    const [{ items, hasNext }, summary, topPages, topCountries] = await Promise.all([
      listVisits(filters, page),
      getSiteSummary(currentSite.id, raw.client, now),
      getTopPages(currentSite.id, raw.client, now),
      getTopCountries(currentSite.id, raw.client, now),
    ]);

    return reply.send(
      renderVisitListPage({
        sites,
        currentSite,
        raw,
        items,
        page,
        hasNext,
        rangeDays,
        summary,
        topPages,
        topCountries,
      }),
    );
  });
}
