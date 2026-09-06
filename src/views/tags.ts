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
 *  Rendered on the session detail head, and on a sessions-list row's first
 *  line — but there only when the visit has no referrer to show instead. */
export function clientChip(client: string | null, reason: string | null): string {
  if (!client || client === "human") return "";
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="tag tag-bot"${title}>${escapeHtml(client)}</span>`;
}

/** "Search crawler" pill — a `search` verdict that arrived with NO referrer:
 *  the search engine's own crawler indexing the page. Whenever a visit has a
 *  real referrer the sessions list shows that referrer (green "via …")
 *  instead of any type pill — see visit-list-page.ts. */
export function searchCrawlerChip(reason: string | null): string {
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="tag tag-bot"${title}>search crawler</span>`;
}

/** One "which page" pill — the purple tag the detail event stream uses for
 *  the page an event happened on. Shows the CONCRETE pathname ("/",
 *  "/ru/feature-slug") once the client recorded one, falling back to the
 *  coarse `page` label for events ingested before path capture. Long paths
 *  ellipsize via .tag's CSS; the tooltip carries the full path and, when a
 *  path is shown, the label it replaced. */
export function pageChip(path: string | null, label: string): string {
  const shown = path ?? label;
  const title = path ? `${label} · ${path}` : label;
  return `<span class="tag tag-page" title="${escapeHtml(title)}">${escapeHtml(shown)}</span>`;
}

/** Entry-page pill for a sessions-list row — the visit's first page, already
 *  reduced to "path ?? label" by the list query (visit-queries.ts). */
export function entryChip(page: string): string {
  return `<span class="tag tag-page" title="${escapeHtml(page)}">${escapeHtml(page)}</span>`;
}
