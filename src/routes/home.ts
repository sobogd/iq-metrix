import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { getDaySummary, listSites, listVisits, markVisitsSeen } from "../lib/visit-queries";
import { madridBoundsFromKey, madridDayKey } from "../lib/madrid";
import { fmtDayHeading } from "../views/format";
import { renderNoSitesPage, renderVisitListPage } from "../views/visit-list-page";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** GET / — one Madrid calendar day (?day=YYYY-MM-DD, default today), picked
 *  in the header's 📅 native date control: the summary strip counts that day
 *  (Visits/Events/Identified), and the list below it is every session that
 *  had activity during it — no pagination, the list IS the day. A session
 *  whose events the admin has not seen yet shows a green "new" dot; the list
 *  marks what it returns as seen (Event.seen). The only knobs left are the
 *  header's company picker (which keeps the day) and the calendar itself. */
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
      listVisits(currentSite.id, start, end),
      getDaySummary(currentSite.id, start, end),
    ]);

    // Everything the list just returned is now "seen": the green dots in the
    // response reflect the PRE-update state, so a session shows its dot on
    // the first load after its events arrived and loses it from the next.
    await markVisitsSeen(items.map((i) => i.id));

    return reply.send(
      renderVisitListPage({
        sites,
        currentSite,
        items,
        dayKey,
        heading: fmtDayHeading(dayKey, now),
        summary,
        refreshHref: request.url,
      }),
    );
  });
}
