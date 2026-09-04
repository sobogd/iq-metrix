import type { FastifyInstance } from "fastify";
import type { Visit } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";
import { type RawFacts, clientNetwork, hashEntropy, visitSeed } from "../lib/request-facts";
import { sessionHash } from "../lib/session-hash";
import { getSalt } from "../lib/salt";
import { applyAttribution, applyIngestSnapshot, continueVisit, resolveVisit } from "../lib/visit";
import { signVisitToken, verifyVisitToken } from "../lib/visit-token";
import { classifyRequest, isScriptUa } from "../lib/client-kind";
import { APP_REGEX, LABEL_REGEX, LOCALE_REGEX, NAME_REGEX } from "../lib/labels";
import {
  type Attribution,
  allowedMetaKeys,
  extractAttribution,
  mergeVisitMeta,
  sanitizeMeta,
} from "../lib/meta-sanitizer";

// The one write path for analytics data. Auth is a shared-secret header, not
// a session — this is a service-to-service call from a relay living inside
// each product (built in a later task), not a browser request.
//
// IMPORTANT: once nginx is set up for this service (not done in this task —
// see README), add `location /ingest { return 404; }` there too, so this
// path is unreachable from the public internet even if X-Ingest-Key leaks.
// The header check below is the only protection until then.

const MAX_EVENTS_PER_BATCH = 50;
// How far a client-supplied event timestamp may sit from server time before
// we stop believing it. Batches can be retried with backoff, so a few
// minutes of lag is normal; anything beyond this is a broken clock.
const TS_MAX_PAST_MS = 6 * 3600_000;
const TS_MAX_FUTURE_MS = 60_000;

interface RawEventBody {
  page?: unknown;
  action?: unknown;
  name?: unknown;
  locale?: unknown;
  meta?: unknown;
  at?: unknown;
}

interface IngestBody {
  site?: unknown;
  app?: unknown;
  ip?: unknown;
  ua?: unknown;
  headers?: unknown;
  email?: unknown;
  meta?: unknown;
  tok?: unknown;
  events?: unknown;
}

interface ParsedEvent {
  page: string;
  action: string;
  name: string;
  locale: string | null;
  meta: Record<string, string>;
  /** from/ref/theme pulled out of this event's raw `meta` — see
   *  extractAttribution. Not part of `meta` above (that's already been
   *  stripped of these reserved keys by sanitizeMeta). */
  attribution: Attribution;
  at: Date | null;
}

function parseTs(raw: unknown, now: Date): Date | null {
  const t = typeof raw === "string" ? Date.parse(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(t)) return null;
  const delta = now.getTime() - t;
  if (delta > TS_MAX_PAST_MS || delta < -TS_MAX_FUTURE_MS) return null;
  return new Date(t);
}

/** Buffered events arrive together; spacing the fallbacks 1ms apart keeps
 *  them in the order the caller produced them. Never lets an event predate
 *  its own visit's firstAt — that would corrupt any "first page" aggregate
 *  computed by ordering on `at`. */
function clampToVisit(at: Date | null, firstAt: Date, now: Date, index: number): Date {
  const fallback = new Date(now.getTime() + index);
  if (!at) return fallback;
  return at < firstAt ? firstAt : at;
}

/** First non-null candidate, in order. Used to pick one from/ref/theme value
 *  out of everything this batch offered (visit-level meta, then each
 *  event's, in array order) before handing it to applyAttribution — whose
 *  own DB-level null guard is what actually decides whether it sticks. */
function firstNonNull(values: ReadonlyArray<string | null>): string | null {
  for (const v of values) if (v !== null) return v;
  return null;
}

function parseEvent(raw: unknown, allowed: ReadonlySet<string>, now: Date): ParsedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawEventBody;
  const page = typeof r.page === "string" && LABEL_REGEX.test(r.page) ? r.page : null;
  const action = typeof r.action === "string" && LABEL_REGEX.test(r.action) ? r.action : null;
  const name = typeof r.name === "string" && NAME_REGEX.test(r.name) ? r.name : null;
  if (!page || !action || !name) return null;
  const locale = typeof r.locale === "string" && LOCALE_REGEX.test(r.locale) ? r.locale.toLowerCase() : null;
  return {
    page,
    action,
    name,
    locale,
    meta: sanitizeMeta(r.meta, allowed),
    attribution: extractAttribution(r.meta),
    at: parseTs(r.at, now),
  };
}

function parseHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function ingestRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/ingest", async (request, reply) => {
    if (request.headers["x-ingest-key"] !== env.ingestSharedSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const now = new Date();
    const body = (request.body ?? {}) as IngestBody;

    if (typeof body.ip !== "string" || !body.ip) {
      return reply.code(400).send({ error: "ip required" });
    }
    if (typeof body.site !== "string" || !body.site) {
      return reply.code(400).send({ error: "site required" });
    }
    const siteId = body.site;
    // Raw ip lives only in this local binding — folded into the hashed
    // `network` value below and never persisted or logged. Do not log
    // `ip`/`body` in this handler, even on an error path.
    const ip = body.ip;
    const ua = typeof body.ua === "string" ? body.ua : "";
    const facts: RawFacts = { ip, ua, headers: parseHeaders(body.headers) };

    // Cheap check, no DB: sheds server-side scripts (curl/axios/headless)
    // before they cost a query. Search/AI/other crawlers are NOT shed — they
    // are stored with a `client` classification so the admin can measure them.
    // Silently accepted (200, no-op) rather than erroring, so as not to
    // signal anything back to whatever sent it.
    if (isScriptUa(ua)) return reply.send({});

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return reply.code(400).send({ error: "unknown site" });
    const allowed = allowedMetaKeys(site.metaKeys);

    const rawEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    const events = rawEvents
      .map((e) => parseEvent(e, allowed, now))
      .filter((e): e is ParsedEvent => e !== null);
    if (events.length === 0) return reply.code(400).send({ error: "event invalid" });

    const app = typeof body.app === "string" && APP_REGEX.test(body.app) ? body.app : null;
    const email = typeof body.email === "string" && body.email ? body.email : null;
    const bodyMeta = sanitizeMeta(body.meta, allowed);
    // `from`/`ref`/`theme` inside `meta` (visit-level here; per-event inside
    // parseEvent above) — reserved keys that bypass the site's metaKeys
    // allowlist entirely and never land in the stored meta blob. See
    // meta-sanitizer.ts's extractAttribution / RESERVED_META_KEYS.
    const bodyAttribution = extractAttribution(body.meta);

    // A batch carrying a valid continuation token lands on its own visit row
    // directly — immune to the hash flapping mid-visit (mobile network
    // prefix or geo changing between requests).
    let visitRow: Visit | null = null;
    if (typeof body.tok === "string" && body.tok) {
      const visitId = verifyVisitToken(body.tok, env.ingestSharedSecret, now);
      if (visitId) visitRow = await continueVisit(siteId, visitId, email, now);
    }
    if (!visitRow) {
      // Raw ip and ua live only on this stack frame — hashed and derived,
      // never stored. Client classification (token analysis + DNS check for
      // engine-looking IPs) only runs when a row has to be created, not for
      // token-continued batches of an existing visit.
      const network = clientNetwork(ip);
      const entropy = hashEntropy(facts);
      const hash = sessionHash(await getSalt(siteId), network, ua, entropy);
      const client = await classifyRequest(facts);
      visitRow = await resolveVisit(siteId, hash, email, visitSeed(facts, client), now);
    }
    // Pin the resolved row: `visitRow` is a `let`, so its narrowing does not
    // survive into the createMany callback below.
    const visit: Visit = visitRow;

    // This call's contributed meta (visit-level + every event's, in order —
    // see mergeVisitMeta's precedence doc) applied onto the visit's existing
    // snapshot. Reserved from/ref/theme keys are already stripped out of
    // both bodyMeta and each event's meta by this point.
    const contributedMeta = mergeVisitMeta({}, bodyMeta, events.map((e) => e.meta));
    await applyIngestSnapshot(visit, { app, meta: contributedMeta }, now);

    // First-write-wins from/ref/theme, independent of the latest-wins meta
    // snapshot above. Candidates are visit-level meta first, then each
    // event's, in order; applyAttribution's own null-guarded update is what
    // actually enforces "only if not already set" (a race-safe DB check, not
    // just this in-memory pick).
    const attributionCandidates: Attribution[] = [bodyAttribution, ...events.map((e) => e.attribution)];
    await applyAttribution(visit.id, {
      from: firstNonNull(attributionCandidates.map((a) => a.from)),
      ref: firstNonNull(attributionCandidates.map((a) => a.ref)),
      theme: firstNonNull(attributionCandidates.map((a) => a.theme)),
    });

    await prisma.event.createMany({
      data: events.map((e, i) => ({
        visitId: visit.id,
        page: e.page,
        action: e.action,
        name: e.name,
        locale: e.locale,
        app,
        meta: e.meta,
        at: clampToVisit(e.at, visit.firstAt, now, i),
      })),
    });

    // Fresh token every response: its liveness window slides with the
    // visit's lastAt.
    return reply.send({ tok: signVisitToken(visit.id, env.ingestSharedSecret, now) });
  });
}
