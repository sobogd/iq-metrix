import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { deleteVisit, getVisitDetail, listSites } from "../lib/visit-queries";
import {
  renderVisitDeletePage,
  renderVisitDetailPage,
  renderVisitNotFoundPage,
} from "../views/visit-detail-page";

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

  // Delete-confirm page. A plain GET that changes nothing — it re-renders the
  // session head so the admin sees exactly what the POST form on this page
  // will remove. This app has no client JS, so this page is the no-JS
  // stand-in for a confirm() dialog.
  fastify.get<{ Params: { id: string } }>("/visits/:id/delete", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    reply.type("text/html; charset=utf-8");
    const [sites, detail] = await Promise.all([listSites(), getVisitDetail(request.params.id)]);
    if (!detail) {
      reply.code(404);
      return reply.send(renderVisitNotFoundPage(sites));
    }
    const site = sites.find((s) => s.id === detail.visit.siteId) ?? null;
    return reply.send(renderVisitDeletePage(detail.visit, detail.events.length, site, sites));
  });

  // POST, never a GET link — deleting is a state change, and this app's rule
  // is that state changes are form posts (see /logout in routes/login.ts), so
  // no bare link or <img> can ever delete a session. The confirm page above
  // must be visited first; re-submitting the form (double click / back
  // button) is a no-op once the row is gone, and the admin always lands back
  // on the sessions list.
  fastify.post<{ Params: { id: string } }>("/visits/:id/delete", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const siteId = await deleteVisit(request.params.id);
    return reply.redirect(siteId ? `/?site=${siteId}` : "/");
  });
}
