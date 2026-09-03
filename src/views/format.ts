import { escapeHtml } from "./layout";

// Small, dependency-free presentation helpers shared by the visit list and
// visit detail pages. Emoji instead of icon fonts, per the project's CSS
// approach (public/style.css) — kept here, not duplicated per view.

export function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** dd.mm hh:mm — compact form for the visit list row. */
export function fmtShortDateTime(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
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

/** Device TYPE icon for the visit list row — only 3 states, per spec. */
export function deviceTypeEmoji(device: string | null): string {
  if (device === "desktop") return "💻";
  if (device === "mobile") return "📱";
  return "🔌";
}

/** OS icon for the visit list row — only 4 states, per spec (windows/macos
 *  fold into "unknown" alongside null/other). */
export function osEmoji(os: string | null): string {
  if (os === "android") return "🤖";
  if (os === "ios") return "🍎";
  if (os === "linux") return "🐧";
  return "🎛️";
}

export function themeEmoji(theme: string | null): string {
  return theme === "dark" ? "🌙" : "☀️";
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
