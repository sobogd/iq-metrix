import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../lib/auth-guard";
import { deleteVisit, getVisitDetail, listSites } from "../lib/visit-queries";
import { madridBoundsFromKey } from "../lib/madrid";
import {
  renderVisitDeletePage,
  renderVisitDetailPage,
  renderVisitNotFoundPage,
} from "../views/visit-detail-page";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The day param the list passes on its row links ("YYYY-MM-DD") — echoed
 *  back so "← Back to visits" / the delete redirect land on the same Madrid
 *  day the admin came from. Anything malformed is dropped (the list then
 *  defaults to today). */
function listDay(q: Record<string, unknown>): string | undefined {
  const raw = str(q.day);
  return raw && madridBoundsFromKey(raw) ? raw : undefined;
}

export async function visitDetailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>("/visits/:id", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    reply.type("text/html; charset=utf-8");
    const q = request.query as Record<string, unknown>;
    const dayKey = listDay(q);
    const [sites, detail] = await Promise.all([listSites(), getVisitDetail(request.params.id)]);
    if (!detail) {
      reply.code(404);
      return reply.send(renderVisitNotFoundPage(sites, dayKey));
    }
    const site = sites.find((s) => s.id === detail.visit.siteId) ?? null;
    return reply.send(renderVisitDetailPage(detail.visit, detail.events, site, sites, dayKey));
  });

  // Delete-confirm page. A plain GET that changes nothing — it re-renders the
  // session head so the admin sees exactly what the POST form on this page
  // will remove. This app has no client JS, so this page is the no-JS
  // stand-in for a confirm() dialog.
  fastify.get<{ Params: { id: string } }>("/visits/:id/delete", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    reply.type("text/html; charset=utf-8");
    const q = request.query as Record<string, unknown>;
    const dayKey = listDay(q);
    const [sites, detail] = await Promise.all([listSites(), getVisitDetail(request.params.id)]);
    if (!detail) {
      reply.code(404);
      return reply.send(renderVisitNotFoundPage(sites, dayKey));
    }
    const site = sites.find((s) => s.id === detail.visit.siteId) ?? null;
    return reply.send(renderVisitDeletePage(detail.visit, detail.events.length, site, sites, dayKey));
  });

  // POST, never a GET link — deleting is a state change, and this app's rule
  // is that state changes are form posts (see /logout in routes/login.ts), so
  // no bare link or <img> can ever delete a session. The confirm page above
  // must be visited first; re-submitting the form (double click / back
  // button) is a no-op once the row is gone, and the admin always lands back
  // on the sessions list — on the same day they came from when there was one.
  fastify.post<{ Params: { id: string } }>("/visits/:id/delete", async (request, reply) => {
    const user = requireAdmin(request, reply);
    if (!user) return;

    const dayKey = listDay(request.query as Record<string, unknown>);
    const siteId = await deleteVisit(request.params.id);
    if (!siteId) return reply.redirect("/");
    return reply.redirect(dayKey ? `/?site=${siteId}&day=${dayKey}` : `/?site=${siteId}`);
  });
}
