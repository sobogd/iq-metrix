import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env";
import { ingestRoutes } from "./routes/ingest";
import { loginRoutes } from "./routes/login";
import { homeRoutes } from "./routes/home";
import { robotsRoutes } from "./routes/robots";

// Read once at boot, served from memory — the only static asset this
// service has right now is the one stylesheet (no build step, no bundler,
// so no reason to pull in a full static-file plugin for a single file).
const styleCss = readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

async function main(): Promise<void> {
  const fastify = Fastify({
    logger: true,
    // Ingest batches are capped at 50 events (see routes/ingest.ts) plus a
    // handful of small string fields — 256KB is generous headroom without
    // leaving the body parser wide open.
    bodyLimit: 256 * 1024,
    // Matters once nginx fronts this service (a later task): request.ip and
    // the rate-limiter's default per-IP key both read X-Forwarded-For then.
    // Harmless locally — falls back to the raw socket address with no proxy
    // in front.
    trustProxy: true,
  });

  // Anti-indexing, app-level half: this header on every response (HTML,
  // JSON, CSS alike). The <meta name="robots"> tag on rendered pages
  // (views/layout.ts) and /robots.txt (routes/robots.ts) are the other two
  // legs. nginx-level headers are separate, later, not part of this task.
  fastify.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
    return payload;
  });

  // Cookie parsing/setting only — session tokens are self-verifying HMAC
  // values (src/lib/session-cookie.ts), so this plugin's own `secret`/signed
  // cookie support is not used.
  await fastify.register(cookie);
  // Lets POST /login accept a plain HTML <form> submit — no JS, no fetch.
  await fastify.register(formbody);
  // global:false — only routes that opt in via `config.rateLimit` are
  // limited (POST /login, see routes/login.ts). /ingest is protected by its
  // shared-secret header instead; nothing else needs a limit yet.
  await fastify.register(rateLimit, { global: false });

  fastify.get("/style.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8");
    return reply.send(styleCss);
  });

  await fastify.register(robotsRoutes);
  await fastify.register(loginRoutes);
  await fastify.register(homeRoutes);
  await fastify.register(ingestRoutes);

  await fastify.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
