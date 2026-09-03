import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env";
import { SESSION_COOKIE_NAME, verifySession } from "./session-cookie";

// Shared by every page route that requires a signed-in admin (routes/home.ts,
// routes/visit-detail.ts). Factored out once there were two call sites —
// duplicating a cookie-read-and-redirect is exactly the kind of thing that
// silently drifts out of sync between routes.

/** Reads and verifies the mtx_sess cookie. Returns the admin username, or
 *  sends a redirect to /login and returns null. Callers must stop handling
 *  the request immediately when this returns null: the reply has already
 *  been sent. */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): string | null {
  const token = request.cookies[SESSION_COOKIE_NAME];
  const user = verifySession(token, env.sessionSecret);
  if (!user) {
    reply.redirect("/login");
    return null;
  }
  return user;
}
