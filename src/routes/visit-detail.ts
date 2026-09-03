import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { getSiteById, getVisitDetail } from "../lib/visit-queries";
import { renderVisitDetailPage, renderVisitNotFoundPage } from "../views/visit-detail-page";

export async function visitDetailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>("/visits/:id", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    reply.type("text/html; charset=utf-8");
    const detail = await getVisitDetail(request.params.id);
    if (!detail) {
      reply.code(404);
      return reply.send(renderVisitNotFoundPage());
    }
    const site = await getSiteById(detail.visit.siteId);
    return reply.send(renderVisitDetailPage(detail.visit, detail.events, site));
  });
}
