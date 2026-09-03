import type { FastifyInstance } from "fastify";
import type { Visit } from "@prisma/client";
import { prisma } from "../db";
import { type RawFacts, clientNetwork, hashEntropy, visitSeed } from "../lib/request-facts";
import { sessionHash } from "../lib/session-hash";
import { getSalt } from "../lib/salt";
import { applyAttribution, applyIngestSnapshot, continueVisit, resolveVisit } from "../lib/visit";
import { signVisitToken, verifyVisitToken } from "../lib/visit-token";
import { isBotUa } from "../lib/bot-filter";
import { APP_REGEX, LABEL_REGEX, LOCALE_REGEX, NAME_REGEX } from "../lib/labels";
import {
  type Attribution,
  allowedMetaKeys,
  extractAttribution,
  mergeVisitMeta,
  sanitizeMeta,
} from "../lib/meta-sanitizer";
import { env } from "../env";

// Public browser-facing ingest for landing (site "iq-rest", app "landing"),
// posting directly instead of through dashboard-api's relay — see the
// tradeoffs noted where this was wired up (dedicated-analytics subdomains
// are an easier ad-blocker target than a domain that also carries core
// product traffic, and there is no server-side spool on this path the way
// the relay has). Kept in its own file rather than folded into ingest.ts:
// that route's trust boundary is "already-resolved facts from a same-machine
// relay behind a shared secret"; this one's is "an anonymous browser", and
// mixing the two behind one conditional invites a boundary bug.
//
// Wire format is each caller's existing lib/analytics(.ts) client,
// UNCHANGED — only the target origin moved to e.iq-rest.com. The iq-rest
// callers already send `credentials: "include"`, so the `iqr_email` cookie
// (UI-readable, set on the .iq-rest.com apex by dashboard-api) rides along
// automatically for them — same-site subdomain requests are not subject to
// SameSite restrictions, only same-ORIGIN credential defaults, which those
// clients already opt out of. translator is a genuinely different eTLD+1
// (cross-SITE, not just cross-subdomain), so its cookie can never arrive
// here regardless of credentials mode — its events land anonymous by
// construction, not by a bug.
//
// One shared endpoint serving three origins needs to know which site/app
// each request is for, and must reflect back only a known origin in CORS
// (not a wildcard — Access-Control-Allow-Credentials forbids that anyway).
// Both come from this same fixed table rather than a client-supplied field:
// letting the caller assert its own site would let anyone script traffic
// into iq-translate's numbers from a page on iq-rest.com, or vice versa.
const ORIGIN_TABLE: Record<string, { site: string; app: string }> = {
  "https://iq-rest.com": { site: "iq-rest", app: "landing" },
  "https://www.iq-rest.com": { site: "iq-rest", app: "landing" },
  "https://dashboard.iq-rest.com": { site: "iq-rest", app: "dashboard-web" },
  "https://iq-translate.com": { site: "iq-translate", app: "web" },
  "https://www.iq-translate.com": { site: "iq-translate", app: "web" },
};
const EMAIL_COOKIE = "iqr_email";

const MAX_EVENTS_PER_BATCH = 50;
const TS_MAX_PAST_MS = 6 * 3600_000;
const TS_MAX_FUTURE_MS = 60_000;

interface RawEventBody {
  page?: unknown;
  action?: unknown;
  name?: unknown;
  locale?: unknown;
  meta?: unknown;
  at?: unknown;
  ts?: unknown;
  loc?: unknown;
}

interface PublicBody {
  events?: unknown;
  ctx?: { from?: unknown; ref?: unknown; theme?: unknown } | unknown;
  tok?: unknown;
}

interface ParsedEvent {
  page: string;
  action: string;
  name: string;
  locale: string | null;
  meta: Record<string, string>;
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

function clampToVisit(at: Date | null, firstAt: Date, now: Date, index: number): Date {
  const fallback = new Date(now.getTime() + index);
  if (!at) return fallback;
  return at < firstAt ? firstAt : at;
}

function firstNonNull(values: ReadonlyArray<string | null>): string | null {
  for (const v of values) if (v !== null) return v;
  return null;
}

// Landing's client sends `ts` (epoch ms) and `loc`, not `at`/`locale` — the
// wire shape the relay-based /ingest route uses. Accept both spellings so
// this route works unmodified against the existing client.
function parseEvent(raw: unknown, allowed: ReadonlySet<string>, now: Date): ParsedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawEventBody;
  const page = typeof r.page === "string" && LABEL_REGEX.test(r.page) ? r.page : null;
  const action = typeof r.action === "string" && LABEL_REGEX.test(r.action) ? r.action : null;
  const name = typeof r.name === "string" && NAME_REGEX.test(r.name) ? r.name : null;
  if (!page || !action || !name) return null;
  const localeRaw = typeof r.locale === "string" ? r.locale : typeof r.loc === "string" ? r.loc : null;
  const locale = localeRaw && LOCALE_REGEX.test(localeRaw) ? localeRaw.toLowerCase() : null;
  const atRaw = r.at ?? r.ts;
  return {
    page,
    action,
    name,
    locale,
    meta: sanitizeMeta(r.meta, allowed),
    attribution: extractAttribution(r.meta),
    at: parseTs(atRaw, now),
  };
}

export async function publicIngestRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/e", async (request, reply) => {
    const origin = request.headers.origin;
    const match = origin ? ORIGIN_TABLE[origin] : undefined;
    if (!match) return reply.code(403).send({ error: "unknown origin" });
    reply.header("Access-Control-Allow-Origin", origin as string);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Vary", "Origin");
    const { site: siteId, app } = match;

    const now = new Date();
    let body: PublicBody;
    try {
      body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body as PublicBody);
    } catch {
      return reply.code(400).send({ error: "invalid body" });
    }

    const ua = request.headers["user-agent"] ?? "";
    // request.ip resolves via trustProxy off X-Forwarded-For (nginx sets it) —
    // never logged or stored, only hashed below (same discipline as /ingest).
    const facts: RawFacts = { ip: request.ip, ua, headers: request.headers as Record<string, string> };

    if (isBotUa(ua)) return reply.send({});

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) return reply.code(500).send({ error: "site not seeded" });
    const allowed = allowedMetaKeys(site.metaKeys);

    const rawEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
    const events = rawEvents
      .map((e) => parseEvent(e, allowed, now))
      .filter((e): e is ParsedEvent => e !== null);
    if (events.length === 0) return reply.code(400).send({ error: "event invalid" });

    // Attribution-only identity: a forged cookie can only mis-attribute the
    // forger's own traffic, never expose anything (same principle every
    // relay in this system already relies on). Only ever present for the
    // iq-rest origins above — translator's cookie jar cannot reach here.
    const emailCookie = request.cookies[EMAIL_COOKIE];
    const email = emailCookie && emailCookie.includes("@") ? emailCookie.toLowerCase() : null;

    const ctx = body.ctx && typeof body.ctx === "object" ? (body.ctx as Record<string, unknown>) : {};
    const bodyAttribution = extractAttribution(ctx);

    let visitRow: Visit | null = null;
    if (typeof body.tok === "string" && body.tok) {
      const visitId = verifyVisitToken(body.tok, env.ingestSharedSecret, now);
      if (visitId) visitRow = await continueVisit(siteId, visitId, email, now);
    }
    if (!visitRow) {
      const network = clientNetwork(facts.ip);
      const entropy = hashEntropy(facts);
      const hash = sessionHash(await getSalt(siteId), network, ua, entropy);
      visitRow = await resolveVisit(siteId, hash, email, visitSeed(facts), now);
    }
    const visit: Visit = visitRow;

    const contributedMeta = mergeVisitMeta({}, {}, events.map((e) => e.meta));
    await applyIngestSnapshot(visit, { app, meta: contributedMeta }, now);

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

    // Landing's client reads the token from `.v`, not `.tok` — matching the
    // original dashboard-api /api/e response shape it was already built
    // against, so the client needed zero changes beyond its target URL.
    return reply.send({ v: signVisitToken(visit.id, env.ingestSharedSecret, now) });
  });

  // Not strictly required for a CORS-simple request (Content-Type: text/plain,
  // no custom headers), but sendBeacon / some browsers still probe with
  // OPTIONS in edge cases — answer it cheaply rather than 404.
  fastify.options("/e", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !ORIGIN_TABLE[origin]) return reply.code(403).send();
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Credentials", "true");
    reply.header("Access-Control-Allow-Methods", "POST");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    reply.header("Vary", "Origin");
    return reply.code(204).send();
  });
}
