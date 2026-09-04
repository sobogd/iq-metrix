import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { getSiteSummary, listSites, listVisits } from "../lib/visit-queries";
import { renderNoSitesPage, renderVisitListPage } from "../views/visit-list-page";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** GET / — today's summary strip (Visits/Events/Identified · today, Live
 *  now) plus the full visits list for the selected site. Deliberately no
 *  filters, no top rankings, no date presets: the page answers "how did the
 *  current Madrid day go", and the list below is the raw drill-down. The
 *  only query knobs left are the topbar site switch and list pagination. */
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
    const page = Math.max(1, Number.parseInt(str(q.page), 10) || 1);

    const now = new Date();
    const [{ items, hasNext }, summary] = await Promise.all([
      listVisits(currentSite.id, page),
      getSiteSummary(currentSite.id, now),
    ]);

    return reply.send(
      renderVisitListPage({
        sites,
        currentSite,
        items,
        page,
        hasNext,
        summary,
      }),
    );
  });
}
