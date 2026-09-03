import type { FastifyInstance } from "fastify";

// Anti-indexing, application level. This plus the X-Robots-Tag header (set
// globally in server.ts) and the <meta name="robots"> tag in every rendered
// page (views/layout.ts) cover indexing at the app layer. nginx-level
// headers/blocks are a separate later task (nginx isn't set up yet).
export async function robotsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/robots.txt", async (_request, reply) => {
    reply.type("text/plain; charset=utf-8");
    return reply.send("User-agent: *\nDisallow: /\n");
  });
}
