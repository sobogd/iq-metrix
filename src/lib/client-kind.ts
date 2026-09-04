import { isbot } from "isbot";
import dns from "node:dns";
import net from "node:net";

// Classifies the client behind a user-agent WITHOUT storing the UA itself
// (the raw string is never persisted — see request-facts.ts). The stored
// `Visit.client` column holds only this label; `Visit.clientReason` holds a
// short token explaining how that label was reached.
//
// Design (see README / decision notes):
//   - UA analysis is a heuristic, never proof. The only *evidence* that a
//     visitor is a real search-engine crawler is its IP: every public engine
//     (Google, Bing, Yandex, DuckDuckGo) publishes the hostnames its
//     crawlers reverse-DNS to. So engine-looking UAs that come from a public
//     IP get verified with reverse + forward DNS (cache per IP, 24h TTL).
//   - Everything else is matched by ANCHORED product tokens (a crawler
//     token like "Googlebot" matched as a token, not a substring anywhere in
//     the UA — substring matching is what falsely labelled non-engine tools
//     as "search"), grouped by class: ai / search / preview / monitor+other
//     bots. Then isbot's curated list, then a "does this look like a real
//     browser at all?" marker check (no Chrome/Safari/Firefox/... family
//     token => almost certainly not a person). Unknown-but-plausible UAs
//     default to human — under-counting bots is preferable to losing real
//     visitors.
//   - Pure server-side scripts (curl/axios/headless) never reach a DB row:
//     they are shed by isScriptUa() in the routes.

export type VisitClient = "human" | "search" | "ai" | "preview" | "bot";

export interface ClientClassification {
  client: VisitClient;
  /** Short token like "token:gptbot", "dns:googlebot.com", "isbot",
   *  "no-browser-markers". Null only for the default "human". */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Anchored token matching
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `ua` contains `token` as a product token — token boundaries on
 *  both sides (start or [space / ; ( ] before, [space / ; ) ] after), never
 *  as a bare substring of some other word ("Edge" in "knowledge", etc.). */
function hasToken(ua: string, token: string): boolean {
  const re = new RegExp(`(?:^|[\\s/;(])${escapeRe(token)}(?=[\\s/;)])`, "i");
  return re.test(ua);
}

/** First token of `tokens` present in the UA (for the `clientReason`), or
 *  null. */
function findToken(ua: string, tokens: readonly string[]): string | null {
  for (const t of tokens) if (hasToken(ua, t)) return t;
  return null;
}

// ---------------------------------------------------------------------------
// Catalogs. A token may appear in several lists in theory — order decides
// (ai before search: some AI crawlers overlap engine names; search before
// preview: e.g. "bingpreview" handled in preview; bot catalog after all).
// ---------------------------------------------------------------------------

// AI assistants / training crawlers.
const AI_TOKENS = [
  "gptbot", "chatgpt", "openai", "oai-searchbot", "gpt-", "claude", "claudebot",
  "anthropic", "perplexitybot", "perplexity", "gemini", "google-extended",
  "bard", "cohere", "youdot", "phind", "kimi", "moonshot", "mistral",
  "meta-externalagent", "meta-externalfetcher", "amazonbot", "bytespider",
  "ccbot", "diffbot", "applebot-extended", "omgili", "imagesiftbot",
] as const;

// Search-engine crawlers. A handful of these are verifiable by DNS (see
// VERIFIABLE_DOMAINS) — those get `verify: <token>` in the classification
// so the request path can confirm the source IP before trusting "search".
const SEARCH_TOKENS = [
  "googlebot", "googlebot-image", "googlebot-news", "googlebot-video",
  "bingbot", "msnbot", "slurp", "duckduckbot", "yandexbot",
  "yandexmobilebot", "baiduspider", "sogou", "yisouspider", "naverbot",
  "seznambot", "qwantify", "petalbot", "applebot",
] as const;

// Social-network / messenger link unfurlers. They hit pages like humans
// (share previews), usually from real product IPs, so they are their own
// class rather than "bot".
const PREVIEW_TOKENS = [
  "twitterbot", "facebookexternalhit", "facebookcatalog", "facebot",
  "slackbot", "linkedinbot", "discordbot", "telegrambot", "whatsapp",
  "skypeuripreview", "pinterest", "pinterestbot", "tumblr", "redditbot",
  "viber", "imessage", "line-preview", "bytedancewebview", "tiktokbot",
  "bingpreview",
] as const;

// Uptime monitors / security scanners — stored, but only as bots.
const MONITOR_TOKENS = [
  "uptimerobot", "pingdom", "site24x7", "statuscake", "newrelicpinger",
  "newrelicsynthetics", "synthetics", "datadogsynthetics", "qualys",
  "catchpoint", "internetseer", "dotcom-monitor", "uptime", "pulsepoint",
  "alertra", "node-supervisor",
] as const;

// Everything else with a known crawler/scraper identity.
const BOT_TOKENS = [
  "adsbot", "adsbot-google", "googleother", "apis-google", "feedfetcher-google",
  "storebot-google", "googleproducer", "google-inspectiontool",
  "chromeos-default-bot", "semrushbot", "ahrefsbot", "majestic", "mj12bot",
  "archive.org_bot", "ia_archiver", "dotbot", "rogerbot", "blexbot",
  "exabot", "dataforseobot", "seokicks", "builtwith", "wappalyzer",
  "seobility", "moz", "mzcrawler", "urlresolver", "linkdexbot", "seegment",
  "ezooms", "jobboerse", "sistrix", "serpstatbot", "spider", "crawler",
  "crawl", "researchscan", "netcraftsurveyagent", "microsoft office",
  "excel", "onenote", "outlook", "skypeforbusiness", "teams",
] as const;

// Product tokens that prove a real browser shell (family identifiers, not
// engines — deliberately includes "Safari", which also rides inside every
// Chrome/Edge UA, because ANY of these means a WebKit/Gecko browser shell
// is present).
const BROWSER_TOKENS = [
  "chrome", "chromium", "firefox", "fxios", "crios", "edg", "edge", "opera",
  "opr", "samsungbrowser", "yabrowser", "safari",
] as const;

// ---------------------------------------------------------------------------
// DNS verification of the big engines
// ---------------------------------------------------------------------------

/** Hostname suffixes each engine's crawlers reverse-DNS to. A token maps to
 *  the engine whose source IPs it must come from. */
const VERIFIABLE_DOMAINS: Record<string, readonly string[]> = {
  googlebot: ["googlebot.com"],
  "googlebot-image": ["googlebot.com"],
  "googlebot-news": ["googlebot.com"],
  "googlebot-video": ["googlebot.com"],
  bingbot: ["search.msn.com"],
  msnbot: ["search.msn.com"],
  duckduckbot: ["duckduckgo.com"],
  yandexbot: ["yandex.ru", "yandex.net"],
  yandexmobilebot: ["yandex.ru", "yandex.net"],
};

const VERIFY_TTL_MS = 24 * 3600_000;
const VERIFY_TIMEOUT_MS = 1500;
// Verdicts are cheap to keep in memory: one short-lived string per engine IP.
const verifyCache = new Map<string, { at: number; verified: boolean; spoof: boolean }>();

function withTimeout<T>(p: Promise<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), VERIFY_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(undefined); },
    );
  });
}

/** Compare addresses ignoring IPv4-mapped-IPv6 wrapping and case. */
function sameAddress(a: string, b: string): boolean {
  const norm = (s: string): string => {
    const lower = s.toLowerCase();
    const mapped = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : lower;
    return mapped.includes(".") ? mapped : lower;
  };
  return norm(a) === norm(b);
}

/** Public (routable) IPv4 only — search engines crawl from IPv4 ranges;
 *  private/CGNAT/link-local addresses are never verified (local dev,
 *  office NATs, Cloudflare's own ranges when the relay sits behind it). */
function isVerifiableIp(rawIp: string): boolean {
  const ip = net.isIP(rawIp) === 4 ? rawIp : "";
  if (!ip) return false;
  const first = Number.parseInt(ip.split(".")[0] ?? "", 10);
  const second = Number.parseInt(ip.split(".")[1] ?? "", 10);
  const firstOk = first > 0 && first < 224; // not 0/loopback/224+/multicast
  if (!firstOk) return false;
  if (first === 10 || first === 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 100 && second >= 64 && second <= 127) return false; // CGNAT
  return true;
}

/**
 * Verify a "this is a search-engine crawler" claim by its IP: reverse-DNS
 * the source, require a hostname under the engine's published suffix, then
 * forward-DNS that hostname and require it to resolve back to the same IP.
 *
 * Returns:
 *   - verified  -> `{ client: "search", reason: "dns:googlebot.com" }`
 *   - spoofed   -> hostname resolves but is NOT the engine's (or does not
 *                  round-trip) -> `{ client: "bot", reason: "dns-spoof:…" }`
 *   - undefined -> IP not verifiable, DNS error/timeout or cache miss with
 *                  no prior verdict — caller keeps the token-based label
 *                  (a DNS outage must not silently reclassify engines).
 */
export async function verifyEngineIp(
  ip: string,
  token: string,
): Promise<ClientClassification | undefined> {
  if (!isVerifiableIp(ip)) return undefined;
  const cached = verifyCache.get(ip);
  if (cached && Date.now() - cached.at < VERIFY_TTL_MS) {
    if (cached.verified) return { client: "search", reason: `dns:${token}` };
    if (cached.spoof) return { client: "bot", reason: `dns-spoof:${token}` };
    return undefined;
  }

  const suffixes = VERIFIABLE_DOMAINS[token];
  if (!suffixes) return undefined;

  const hostnames = (await withTimeout(dns.promises.reverse(ip))) ?? [];
  const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
  const mine = hostnames.find((h) => {
    const l = h.toLowerCase();
    return lowerSuffixes.some((s) => l === s || l.endsWith(`.${s}`));
  });
  if (!mine) {
    if (hostnames.length > 0) {
      // The IP resolves, but not to this engine — UA says Googlebot, DNS
      // says something else entirely. That is a spoofed crawler.
      verifyCache.set(ip, { at: Date.now(), verified: false, spoof: true });
      return { client: "bot", reason: `dns-spoof:${token}` };
    }
    return undefined; // no PTR record / DNS error — stay on the token label
  }

  const addrs = (await withTimeout(dns.promises.lookup(mine, { all: true }))) ?? [];
  if (addrs.some((a) => sameAddress(a.address, ip))) {
    verifyCache.set(ip, { at: Date.now(), verified: true, spoof: false });
    return { client: "search", reason: `dns:${token}` };
  }
  verifyCache.set(ip, { at: Date.now(), verified: false, spoof: true });
  return { client: "bot", reason: `dns-spoof:${token}` };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface ClassifyResult extends ClientClassification {
  /** When the UA matches a DNS-verifiable engine, the token to verify. */
  verify?: string;
}

export function classifyClient(ua: string): ClassifyResult {
  const ai = findToken(ua, AI_TOKENS);
  if (ai) return { client: "ai", reason: `token:${ai}` };

  const search = findToken(ua, SEARCH_TOKENS);
  if (search) {
    const verifiable = VERIFIABLE_DOMAINS[search] !== undefined;
    return {
      client: "search",
      reason: `token:${search}`,
      ...(verifiable ? { verify: search } : {}),
    };
  }

  const preview = findToken(ua, PREVIEW_TOKENS);
  if (preview) return { client: "preview", reason: `preview:${preview}` };

  const monitor = findToken(ua, MONITOR_TOKENS);
  if (monitor) return { client: "bot", reason: `monitor:${monitor}` };

  const bot = findToken(ua, BOT_TOKENS);
  if (bot) return { client: "bot", reason: `token:${bot}` };

  if (ua && isbot(ua)) return { client: "bot", reason: "isbot" };

  // No known crawler identity: does this even look like a browser? A UA
  // with none of the browser-family product tokens is a tool of some kind
  // (an app framework UA, a scraping client that cleared the script regex,
  // a crawler we have no catalog entry for). Everything else defaults to
  // human — never label a plausible browser as a bot.
  if (ua && !findToken(ua, BROWSER_TOKENS)) {
    return { client: "bot", reason: "no-browser-markers" };
  }
  return { client: "human", reason: null };
}

/**
 * Full classification for a request: token analysis, plus DNS verification
 * of engine-looking UAs when the source IP is publicly routable. This is
 * the async entry point routes call once per ingest before creating a visit.
 */
export async function classifyRequest(facts: { ip: string; ua: string }): Promise<ClientClassification> {
  const c = classifyClient(facts.ua);
  if (c.verify) {
    const verified = await verifyEngineIp(facts.ip, c.verify);
    if (verified) return verified;
  }
  return { client: c.client, reason: c.reason };
}

// Server-side scripts that never represent a real visitor browsing a product
// (curl/axios/headless browsers, SEO tools). Dropped before any DB work —
// nothing about them is useful analytics.
const SCRIPT_REGEX =
  /axios\/|node-fetch|got\/|http_request|httpclient|java\/|okhttp|libwww|lwp-trivial|HttpClient|Apache-HttpClient|python-requests|curl\/|wget|HeadlessChrome|PhantomJS|Screaming Frog|Sitebulb/i;

/** True when the UA is a script (or empty — no real browser sends an empty
 *  UA) and should be dropped rather than stored. Everything else is stored
 *  with its `classifyClient` label. */
export function isScriptUa(ua: string): boolean {
  if (!ua) return true;
  return SCRIPT_REGEX.test(ua);
}
