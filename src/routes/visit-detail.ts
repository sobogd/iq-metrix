import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { getVisitDetail, listSites } from "../lib/visit-queries";
import { renderVisitDetailPage, renderVisitNotFoundPage } from "../views/visit-detail-page";

export async function visitDetailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>("/visits/:id", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    reply.type("text/html; charset=utf-8");
    const [sites, detail] = await Promise.all([listSites(), getVisitDetail(request.params.id)]);
    if (!detail) {
      reply.code(404);
      return reply.send(renderVisitNotFoundPage(sites));
    }
    const site = sites.find((s) => s.id === detail.visit.siteId) ?? null;
    return reply.send(renderVisitDetailPage(detail.visit, detail.events, site, sites));
  });
}
