import { escapeHtml } from "./layout";
import { madridBoundsFromKey, madridDayKey, madridYmd, shiftMadridDay } from "../lib/madrid";

// Small, dependency-free presentation helpers shared by the visit list and
// visit detail pages. Emoji instead of icon fonts, per the project's CSS
// approach (public/style.css) — kept here, not duplicated per view.

// Every timestamp this admin shows is rendered on a Europe/Madrid clock,
// regardless of the server's own timezone. (The DB stores UTC instants;
// the ingest and salt logic were already Madrid-anchored — see lib/salt.ts —
// and the admin UI now reads the same clock.) This also keeps the times
// stable across a server whose TZ is UTC, as prod runs it.
const MADRID_TZ = "Europe/Madrid";

/** "04 Sep, 23:15" — Europe/Madrid, for the detail page / events table. */
export function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** dd.mm hh:mm — compact Europe/Madrid form for the visit list row. */
export function fmtShortDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
}

/** "20:34:51" — clock with seconds, Europe/Madrid. Event rows in the session
 *  detail lean on it so the order of events (often seconds apart) is
 *  readable without a whole date per row. */
export function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** Calendar-day key of a timestamp on the Madrid clock ("27.08.2025") — used
 *  to break a long event stream into per-day groups. */
export function fmtMadridDay(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/** "27 Aug 2025" — label for the per-day group dividers above event rows. */
export function fmtDayLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Heading for the list's day navigator: "Today" for the current Madrid day,
 *  "Yesterday" for the previous one, otherwise the Madrid date as
 *  "Fri, 04 Sep" — plus the year once the day is no longer in the current
 *  one (so a jump across New Year never reads as this year's date). */
export function fmtDayHeading(key: string, now: Date = new Date()): string {
  const today = madridDayKey(now);
  if (key === today) return "Today";
  if (shiftMadridDay(key, 1) === today) return "Yesterday";
  const bounds = madridBoundsFromKey(key);
  if (!bounds) return key;
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: MADRID_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  if (madridYmd(bounds.start).y !== madridYmd(now).y) opts.year = "numeric";
  return new Intl.DateTimeFormat("en-GB", opts).format(bounds.start);
}

/** Human duration between two timestamps: "42s", "3m", "1h 12m", "2d 4h". */
export function fmtDuration(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** "27.08 20:17→20:35" — first→last activity on one line for the compact
 *  session head; when the span crosses midnight the day repeats:
 *  "26.08 23:50 → 27.08 00:05". */
export function fmtVisitRange(from: Date, to: Date): string {
  const a = fmtShortDateTime(from);
  const b = fmtShortDateTime(to);
  return a.slice(0, 5) === b.slice(0, 5) ? `${a}→${b.slice(6)}` : `${a} → ${b}`;
}

/** Flag emoji from a 2-letter ISO country code via the Unicode regional
 *  indicator trick. "XX" (this service's own default for "unknown") and
 *  anything else non-ISO-shaped falls back to a globe. */
export function countryEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code) || code.toUpperCase() === "XX") return "🌐";
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
}

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Full country name for the flag's hover tooltip. */
export function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code) || code.toUpperCase() === "XX") return "Unknown";
  return countryDisplayNames.of(code.toUpperCase()) ?? code.toUpperCase();
}

export function deviceEmoji(device: string | null): string {
  if (device === "mobile") return "📱";
  if (device === "tablet") return "📟";
  if (device === "desktop") return "🖥️";
  return "❓";
}

/** A site's metaKeys registry, loosely typed — it's a Prisma Json column, so
 *  this is the runtime shape we choose to trust after a typeof guard, not
 *  something Prisma can validate for us. */
export interface MetaKeyConfig {
  label?: unknown;
  link?: unknown;
}
export type MetaKeysRegistry = Record<string, MetaKeyConfig>;

export function asMetaKeysRegistry(raw: unknown): MetaKeysRegistry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as MetaKeysRegistry;
}

/** A Visit/Event `meta` Json column, coerced to the string-map shape the
 *  ingest sanitizer guarantees it was written as (src/lib/meta-sanitizer.ts) —
 *  defensively re-checked here rather than trusted blindly, since this is
 *  read back out of the database, not the same request that validated it. */
export function coerceMeta(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Meta chips, rendered generically from a site's metaKeys registry — this
 * function never hardcodes a key name like "restaurantId"/"topicId". A key
 * with a `link` template (containing a literal `{v}`) renders as an
 * external link (target=_blank) to the source product's own admin; anything
 * else renders as plain text. Unregistered keys (should not happen — the
 * ingest sanitizer already filters against the same registry — but this is
 * read-time code, not the same request) fall back to showing the raw key.
 */
export function renderMetaChips(
  meta: Record<string, string>,
  registry: MetaKeysRegistry,
  linkable = true,
): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return `<span class="muted">—</span>`;
  return entries
    .map(([key, value]) => {
      const cfg = registry[key];
      const label = typeof cfg?.label === "string" ? cfg.label : key;
      const text = `${escapeHtml(label)}: ${escapeHtml(value)}`;
      if (linkable && typeof cfg?.link === "string" && cfg.link.includes("{v}")) {
        const href = cfg.link.replace("{v}", encodeURIComponent(value));
        return `<a class="chip" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return `<span class="chip">${text}</span>`;
    })
    .join("");
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
