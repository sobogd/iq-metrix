import type { FastifyInstance } from "fastify";
import { env } from "../env";
import { SESSION_COOKIE_NAME, verifySession } from "../lib/session-cookie";
import { renderHomePage } from "../views/home-page";

export async function homeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const user = verifySession(token, env.sessionSecret);
    if (!user) return reply.redirect("/login");
    reply.type("text/html; charset=utf-8");
    return reply.send(renderHomePage(user));
  });
}
