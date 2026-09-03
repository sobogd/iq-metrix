import type { FastifyInstance } from "fastify";
import { env } from "../env";
import { verifyPassword } from "../lib/password";
import { SESSION_COOKIE_NAME, constantTimeEqual, signSession, verifySession } from "../lib/session-cookie";
import { renderLoginPage } from "../views/login-page";

interface LoginBody {
  user?: unknown;
  password?: unknown;
}

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days, matches signSession's own TTL

export async function loginRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/login", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (verifySession(token, env.sessionSecret)) return reply.redirect("/");
    reply.type("text/html; charset=utf-8");
    return reply.send(renderLoginPage());
  });

  fastify.post(
    "/login",
    // Real protection against credential brute-forcing — the only route
    // that gets a rate limit (the ingest boundary is protected by its
    // shared-secret header instead, per the /ingest contract).
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as LoginBody;
      const user = typeof body.user === "string" ? body.user : "";
      const password = typeof body.password === "string" ? body.password : "";

      // Both halves constant-time: the username via hash-then-compare
      // (constantTimeEqual), the password via scrypt + timingSafeEqual
      // inside verifyPassword. Evaluate both unconditionally (no `&&`
      // short-circuit before verifyPassword) so a wrong username can't be
      // distinguished from a wrong password by response time.
      const userOk = constantTimeEqual(user, env.adminUser);
      const passOk = verifyPassword(password, env.adminPasswordHash);
      if (!userOk || !passOk) {
        reply.code(401);
        reply.type("text/html; charset=utf-8");
        return reply.send(renderLoginPage("Invalid username or password"));
      }

      const token = signSession(env.adminUser, env.sessionSecret);
      reply.setCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE_S,
        // No `domain` set on purpose — host-only cookie. This will live on
        // a *.iq-rest.com subdomain and must never be confused with (or
        // sent to) the iq-rest product's own session cookie.
      });
      return reply.redirect("/");
    },
  );

  // POST, not GET/link — logout changes state, so it should not be a bare
  // navigable link (CSRF-by-link). The one form on the home page posts here.
  fastify.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.redirect("/login");
  });
}
