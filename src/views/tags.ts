import { escapeHtml } from "./layout";

// The shared colored-text-pill vocabulary used by BOTH the sessions list rows
// (visit-list-page.ts) and the session detail page (visit-detail-page.ts), so
// the two surfaces always look identical: a "chip" is one attribute of the
// visit (OS, device class, source, theme, …). Kept here, not duplicated per
// view — never hardcode an emoji into these pills, per the project's approach.

const OS_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
};

const THEME_LABELS: Record<string, { text: string; cls: string }> = {
  dark: { text: "dark", cls: "tag-theme-dark" },
  light: { text: "light", cls: "tag-theme-light" },
};

/** One colored text pill. All dynamic text is escaped here. */
export function chip(cls: string, text: string): string {
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

export function osChip(os: string | null): string {
  const label = os ? OS_LABELS[os] : undefined;
  return label ? chip("tag-os", label) : "";
}

/** Device-class chip — only "Tablet". Desktop/mobile are already implied
 *  by the OS chip (Windows/macOS/Linux are always desktop; iOS/Android are
 *  phone-sized by default), but a tablet keeps the same OS name, so the one
 *  case worth calling out is when the visit really came from a tablet. */
export function deviceChip(device: string | null): string {
  return device === "tablet" ? chip("tag-device", "Tablet") : "";
}

/** Source chip: the referrer when there is one, otherwise the `from` tag.
 *  UA client classification (search/AI/bot) is deliberately NOT part of this
 *  pill — it misfires on non-browser tools and only confuses the list. Long
 *  values truncate to one line via CSS, so the title carries the full text. */
export function sourceChip(from: string | null, ref: string | null): string {
  const raw = ref ? `via ${ref}` : from ? `from ${from}` : "";
  if (!raw) return "";
  return `<span class="tag tag-source" title="${escapeHtml(raw)}">${escapeHtml(raw)}</span>`;
}

export function themeChip(theme: string | null): string {
  const t = theme ? THEME_LABELS[theme] : undefined;
  return t ? chip(t.cls, t.text) : "";
}

/** Non-human traffic (search engine, AI crawler, link preview, bot) — a
 *  small red pill whose tooltip carries the classification reason token.
 *  Rendered on the session detail head and on a sessions-list row's first
 *  line, right before the event count. */
export function clientChip(client: string | null, reason: string | null): string {
  if (!client || client === "human") return "";
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="tag tag-bot"${title}>${escapeHtml(client)}</span>`;
}

/** "Search crawler" pill — a `search` verdict that arrived with NO referrer:
 *  the search engine's own crawler indexing the page. A search verdict that
 *  DOES carry a referrer is a genuine search click-through and is shown on
 *  the sessions list as that referrer (green "via …") instead of this pill. */
export function searchCrawlerChip(reason: string | null): string {
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="tag tag-bot"${title}>search crawler</span>`;
}
