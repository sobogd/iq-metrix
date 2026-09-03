import { UAParser } from "ua-parser-js";
import { classifyClient, type VisitClient } from "./client-kind";

// Everything we derive from the raw request facts the relay forwards.
//
// Ported from iq-rest (apps/dashboard-api/src/analytics-v2/request-facts.ts)
// and translator (lib/analytics/request-facts.ts). Both reference versions
// take a framework Request object (Express / Web Headers) directly; this
// service instead receives already-resolved facts from a relay (see the
// /ingest contract in src/routes/ingest.ts), so everything here works off a
// plain `{ ip, ua, headers }` shape rather than pulling values out of a
// framework request. The parsing logic itself (network coarsening, UA
// classification, entropy) is unchanged.

export interface RawFacts {
  /** Real client IP, already resolved by the relay from ITS OWN trusted
   *  proxy header. Used only in memory to derive the session hash — never
   *  persisted anywhere, not even in logs. */
  ip: string;
  ua: string;
  headers: Record<string, string>;
}

const LANG_MAX = 35;
/** Accept-Language is used whole (not just the primary tag) as hash entropy;
 *  cap it so a pathological header can't blow up the digest input. */
const LANG_HEADER_MAX = 200;

/** Case-insensitive header lookup — the relay forwards a plain object and we
 *  cannot assume it normalised key casing. */
function header(facts: RawFacts, name: string): string {
  const needle = name.toLowerCase();
  for (const key of Object.keys(facts.headers)) {
    if (key.toLowerCase() === needle) return facts.headers[key] ?? "";
  }
  return "";
}

/**
 * Network the client is on, rather than its exact address: IPv4 keeps the
 * /24, IPv6 the /64.
 *
 * The full address is not stable enough to identify a visit. A phone on a
 * mobile network hands out temporary IPv6 addresses whose low 64 bits rotate
 * between connections, so three page loads seconds apart arrive as three
 * different addresses — and therefore three different hashes, splitting one
 * visitor into three visits. The /64 is the part the carrier actually
 * assigns and it survives that rotation. Coarsening also means the hash
 * input is no longer a single device's address, which is the direction
 * privacy wants anyway; the entropy lost here is paid back by the locale and
 * geo in hashEntropy().
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV4_WITH_PORT = /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/;

/** "0db8" and "db8" are the same group; without this they would hash as two
 *  different networks. */
function normaliseGroup(group: string): string {
  const trimmed = group.replace(/^0+/, "");
  return trimmed === "" ? "0" : trimmed.toLowerCase();
}

export function clientNetwork(rawIp: string): string {
  if (!rawIp) return "";
  // "1.2.3.4:5678" — an upstream hop may carry a port. Left in, it would make
  // every request its own network and therefore its own visit.
  const ip = IPV4_WITH_PORT.test(rawIp) ? rawIp.slice(0, rawIp.lastIndexOf(":")) : rawIp;
  if (ip.includes(":")) {
    const bare = ip.split("%")[0] ?? ""; // drop any zone id
    // IPv4-mapped IPv6 ("::ffff:203.0.113.9"). Treating it as IPv6 would keep
    // only the leading zero groups, collapsing every such visitor onto the
    // single prefix "0:0:0:0" — one shared bucket for all of them.
    const mapped = bare.split(":").pop() ?? "";
    if (IPV4.test(mapped)) return mapped.split(".").slice(0, 3).join(".");

    const [head, tail] = bare.includes("::") ? bare.split("::", 2) : [bare, null];
    const left = (head ? head.split(":") : []).map(normaliseGroup);
    if (tail === null) return left.slice(0, 4).join(":");
    // "::" stands for a run of zero groups. Expanding it matters: leaving an
    // abbreviated address alone would keep the volatile low bits in the hash
    // for exactly the addresses that abbreviate.
    const right = (tail ? tail.split(":") : []).map(normaliseGroup);
    const zeros = Math.max(0, 8 - left.length - right.length);
    return [...left, ...Array(zeros).fill("0"), ...right].slice(0, 4).join(":");
  }
  const octets = ip.split(".");
  return octets.length === 4 ? octets.slice(0, 3).join(".") : ip;
}

function decodeHeader(facts: RawFacts, name: string): string {
  const v = header(facts, name);
  if (!v) return "";
  try {
    return decodeURIComponent(v).slice(0, 100);
  } catch {
    return v.slice(0, 100);
  }
}

/** Full primary Accept-Language tag, e.g. "es-ES" (kept as-is, not
 *  shortened). */
export function acceptLanguage(facts: RawFacts): string | null {
  const raw = header(facts, "accept-language");
  if (!raw) return null;
  const tag = raw.split(",")[0]?.split(";")[0]?.trim();
  if (!tag || tag.length > LANG_MAX || !/^[A-Za-z0-9-]+$/.test(tag)) return null;
  return tag;
}

export function classifyDevice(uaString: string): { device: string | null; os: string | null } {
  if (!uaString) return { device: null, os: null };
  try {
    const parser = new UAParser(uaString);
    const dev = parser.getDevice().type;
    const osName = (parser.getOS().name || "").toLowerCase();
    const device = dev === "mobile" || dev === "tablet" ? dev : "desktop";
    let os: string | null = "other";
    if (osName.includes("ios")) os = "ios";
    else if (osName.includes("android")) os = "android";
    else if (osName.includes("windows")) os = "windows";
    else if (osName.includes("mac") || osName.includes("os x")) os = "macos";
    else if (
      osName.includes("linux") ||
      osName.includes("ubuntu") ||
      osName.includes("fedora") ||
      osName.includes("debian")
    )
      os = "linux";
    return { device, os };
  } catch {
    return { device: null, os: null };
  }
}

/** Facts stamped on a visit row when it is created. */
export interface VisitSeed {
  device: string | null;
  os: string | null;
  country: string;
  region: string;
  city: string;
  lang: string | null;
  /** UA classification (never the raw UA) — see client-kind.ts. */
  client: VisitClient;
}

/**
 * Geo header names match what iq-rest/translator already use behind
 * Cloudflare / nginx+geoip2 (cf-ipcountry / cf-region / cf-ipcity) — the
 * relay forwards whatever it has under those same names, so this pipeline
 * stays one codebase across all three products. Absent in local dev (no
 * relay/proxy in front there): country falls back to "XX".
 */
export function visitSeed(facts: RawFacts): VisitSeed {
  const { device, os } = classifyDevice(facts.ua);
  return {
    device,
    os,
    country: header(facts, "cf-ipcountry") || "XX",
    region: decodeHeader(facts, "cf-region"),
    city: decodeHeader(facts, "cf-ipcity"),
    lang: acceptLanguage(facts),
    client: classifyClient(facts.ua),
  };
}

/**
 * Extra hash entropy beyond ip+ua. Behind a carrier CGNAT or an office NAT
 * the ip+ua pair alone is shared by many people at once (a hundred iPhones
 * on the same Safari build look identical), which would collapse them into a
 * single anonymous visit — and let whichever of them signed in first inherit
 * the others' events. The full Accept-Language header plus the geo
 * country/region split that crowd apart without storing anything on the
 * device.
 */
export function hashEntropy(facts: RawFacts): string {
  const lang = header(facts, "accept-language").slice(0, LANG_HEADER_MAX);
  const country = header(facts, "cf-ipcountry");
  const region = decodeHeader(facts, "cf-region");
  return `${lang}|${country}|${region}`;
}
