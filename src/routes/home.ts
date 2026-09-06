import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { getDaySummary, listSites, listVisits } from "../lib/visit-queries";
import { madridBoundsFromKey, madridDayKey, shiftMadridDay } from "../lib/madrid";
import { fmtDayHeading } from "../views/format";
import { renderNoSitesPage, renderVisitListPage } from "../views/visit-list-page";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** GET / — one Madrid calendar day, chosen in the header's date navigator
 *  (?day=YYYY-MM-DD, default today): the summary strip counts that day
 *  (Visits/Events/Identified — there is no live number), and the list below
 *  it is every session that had activity during it — no pagination, the
 *  list IS the day, and sessions with an event in the last ~30 minutes are
 *  highlighted as live with a green border. The only query knobs left are
 *  the topbar site switch (which keeps the day) and the arrows/heading of
 *  the navigator. */
export async function homeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const sites = await listSites();
    reply.type("text/html; charset=utf-8");
    if (sites.length === 0) return reply.send(renderNoSitesPage());

    const now = new Date();
    const todayKey = madridDayKey(now);
    const q = request.query as Record<string, unknown>;
    const requestedSite = str(q.site);
    const currentSite = sites.find((s) => s.id === requestedSite) ?? sites[0]!;

    // ?day= names a Madrid calendar day; anything malformed falls back to
    // today (a pasted/wrong param never blanks the page).
    const rawDay = str(q.day);
    const dayKey = (rawDay && madridBoundsFromKey(rawDay) ? rawDay : todayKey) as string;
    const { start, end } = madridBoundsFromKey(dayKey)!;

    const [items, summary] = await Promise.all([
      listVisits(currentSite.id, start, end, now),
      getDaySummary(currentSite.id, start, end),
    ]);

    return reply.send(
      renderVisitListPage({
        sites,
        currentSite,
        items,
        dayKey,
        heading: fmtDayHeading(dayKey, now),
        prevKey: shiftMadridDay(dayKey, -1),
        nextKey: shiftMadridDay(dayKey, 1),
        todayKey,
        canNext: dayKey < todayKey,
        summary,
        refreshHref: request.url,
      }),
    );
  });
}
