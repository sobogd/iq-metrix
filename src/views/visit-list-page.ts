import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout } from "./layout";
import {
  asMetaKeysRegistry,
  coerceMeta,
  countryEmoji,
  countryName,
  deviceTypeEmoji,
  fmtDuration,
  fmtShortDateTime,
  osEmoji,
  renderMetaChips,
  themeEmoji,
  type MetaKeysRegistry,
} from "./format";
import type { QueryFilters, RankedItem, SiteSummary, VisitListItem } from "../lib/visit-queries";

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  raw: QueryFilters;
  items: VisitListItem[];
  page: number;
  hasNext: boolean;
  rangeDays: number;
  summary: SiteSummary;
  topPages: RankedItem[];
  topCountries: RankedItem[];
}

function topbar(sites: Site[], currentSiteId?: string): string {
  const siteLinks = sites
    .map((s) => `<a href="/?site=${escapeHtml(s.id)}" class="site-link${s.id === currentSiteId ? " active" : ""}">${escapeHtml(s.id)}</a>`)
    .join("");
  return `
<header class="topbar">
  <div class="topbar-inner">
    <h1>📊 iq-metrix</h1>
    ${siteLinks ? `<nav class="site-nav">${siteLinks}</nav>` : ""}
    <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
  </div>
</header>`;
}

export function renderNoSitesPage(): string {
  const body = `${topbar([])}<main class="placeholder">
    <p>⚠️ No sites configured yet.</p>
    <p class="muted">Run <code>npx prisma db seed</code> against this service's database, then reload.</p>
  </main>`;
  return renderLayout("No sites", body);
}

/** Four scalar stat cards — the at-a-glance numbers that replaced the old
 *  charts, deliberately chart-free. */
function renderSummary(s: SiteSummary): string {
  const cards: Array<{ label: string; value: string; live?: boolean }> = [
    { label: "Visits · 24h", value: String(s.visits24h) },
    { label: "Events · 24h", value: String(s.events24h) },
    { label: "Identified · 7d", value: String(s.emails7d) },
    { label: "Live now", value: String(s.liveNow), live: true },
  ];
  return `<section class="summary">${cards
    .map(
      (c) => `<div class="stat${c.live ? " stat-live" : ""}">
        <span class="stat-value">${escapeHtml(c.value)}</span>
        <span class="stat-label">${escapeHtml(c.label)}</span>
      </div>`,
    )
    .join("")}</section>`;
}

function renderRanked(title: string, rows: Array<{ labelHtml: string; count: number }>): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (r) => `<li class="rank-row">
        <span class="rank-label">${r.labelHtml}</span>
        <span class="rank-count">${escapeHtml(String(r.count))}</span>
      </li>`,
    )
    .join("");
  return `<section class="breakdown">
    <h2>${escapeHtml(title)}</h2>
    <ol class="rank-list">${items}</ol>
  </section>`;
}

function renderBreakdowns(topPages: RankedItem[], topCountries: RankedItem[]): string {
  const pages = renderRanked(
    "Top pages · 7d",
    topPages.map((p) => ({ labelHtml: escapeHtml(p.label), count: p.count })),
  );
  const countries = renderRanked(
    "Top countries · 7d",
    topCountries.map((c) => ({
      labelHtml: `${countryEmoji(c.label)} ${escapeHtml(countryName(c.label))}`,
      count: c.count,
    })),
  );
  if (!pages && !countries) return "";
  return `<section class="breakdowns">${pages}${countries}</section>`;
}

/** Quick date-range presets. They reset to just site + range (clear other
 *  filters) — the filter form below is for precise filtering after. */
function renderPresets(raw: QueryFilters, rangeDays: number): string {
  const presets: Array<{ label: string; d: number }> = [
    { label: "1d", d: 1 },
    { label: "7d", d: 7 },
    { label: "30d", d: 30 },
    { label: "All", d: 0 },
  ];
  const links = presets
    .map((p) => {
      const params = new URLSearchParams();
      if (raw.site) params.set("site", raw.site);
      if (p.d) params.set("range", String(p.d));
      const qs = params.toString();
      return `<a class="preset${p.d === rangeDays ? " active" : ""}" href="/${qs ? `?${qs}` : ""}">${escapeHtml(p.label)}</a>`;
    })
    .join("");
  return `<nav class="presets">${links}</nav>`;
}

function renderFilterForm(f: QueryFilters, registry: MetaKeysRegistry): string {
  const metaKeyOptions = [
    `<option value="">— any —</option>`,
    ...Object.entries(registry).map(([key, cfg]) => {
      const label = typeof cfg.label === "string" ? cfg.label : key;
      return `<option value="${escapeHtml(key)}"${key === f.metaKey ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }),
  ].join("");

  return `
  <form class="filters" method="get" action="/">
    <input type="hidden" name="site" value="${escapeHtml(f.site)}" />
    <label>App
      <input type="text" name="app" value="${escapeHtml(f.app)}" placeholder="dashboard" />
    </label>
    <label>Client
      <select name="client">
        <option value="human"${f.client === "human" ? " selected" : ""}>Human</option>
        <option value="all"${f.client === "all" ? " selected" : ""}>All</option>
        <option value="search"${f.client === "search" ? " selected" : ""}>Search engines</option>
        <option value="ai"${f.client === "ai" ? " selected" : ""}>AI agents</option>
        <option value="bot"${f.client === "bot" ? " selected" : ""}>Other bots</option>
      </select>
    </label>
    <label>From
      <input type="date" name="from" value="${escapeHtml(f.from)}" />
    </label>
    <label>To
      <input type="date" name="to" value="${escapeHtml(f.to)}" />
    </label>
    <label>Email
      <input type="text" name="email" value="${escapeHtml(f.email)}" placeholder="name@example.com" />
    </label>
    <label>Meta key
      <select name="metaKey">${metaKeyOptions}</select>
    </label>
    <label>Meta value
      <input type="text" name="metaValue" value="${escapeHtml(f.metaValue)}" />
    </label>
    <button type="submit">🔎 Filter</button>
    <a class="link-btn" href="/?site=${escapeHtml(f.site)}">✕ Reset</a>
  </form>`;
}

/** Small label for non-human traffic; empty for humans/legacy (keeps the
 *  default list clean). */
function clientBadge(client: string | null): string {
  if (client === "search") return `<span class="client-badge client-search">search</span>`;
  if (client === "ai") return `<span class="client-badge client-ai">AI</span>`;
  if (client === "bot") return `<span class="client-badge client-bot">bot</span>`;
  return "";
}

/** One visit = one compact row, mobile-first:
 *  - line 1: identity (email/Anonymous) + app badge + client badge
 *  - line 2: device/os/theme icons · event count · distinct pages · duration ·
 *            entry→exit pages · city · locale
 *  - line 3 (when present): meta chips (restaurant/topic, non-clickable here —
 *    the row itself is a link), folded-anonymous count, attribution. */
function renderRow(item: VisitListItem, registry: MetaKeysRegistry): string {
  const flag = countryEmoji(item.country);
  const identity = item.email
    ? `<span class="visit-id">✉️ <span class="visit-email">${escapeHtml(item.email)}</span></span>`
    : `<span class="visit-id">👻 <span class="visit-email">Anonymous</span></span>`;
  const appBadge = item.app ? `<span class="app-badge">${escapeHtml(item.app)}</span>` : "";

  const icons = [deviceTypeEmoji(item.device), osEmoji(item.os), themeEmoji(item.theme)].join(" ");
  const stats = [`${item.eventCount} evt`];
  if (item.pageCount > 1) stats.push(`${item.pageCount} pages`);
  stats.push(fmtDuration(item.firstAt, item.lastAt));

  const journey = item.firstPage && item.lastPage
    ? item.firstPage === item.lastPage
      ? item.firstPage
      : `${item.firstPage} → ${item.lastPage}`
    : item.lastPage ?? item.firstPage ?? "";
  if (journey) stats.push(journey);

  const locale = item.city || item.region || "";
  if (locale) stats.push(locale);
  if (item.lang) stats.push(item.lang);

  // Meta chips are rendered non-clickable on the list: the whole row is a link
  // to the visit detail, so nested <a> is not allowed (the detail page renders
  // the same chips WITH their external links).
  const metaChips = renderMetaChips(coerceMeta(item.meta), registry, false);
  const tags: string[] = [];
  if (item.mergeCount > 0) tags.push(`🔗 merged ${item.mergeCount} anon`);
  const fromRef = item.from || item.ref;
  if (fromRef) tags.push(`via ${escapeHtml(fromRef)}`);

  const contextLine =
    metaChips || tags.length
      ? `<div class="visit-tags">${metaChips}${tags.map((t) => `<span class="visit-tag">${t}</span>`).join("")}</div>`
      : "";

  return `
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}">
    <span class="flag-wrap" title="${escapeHtml(countryName(item.country))}">${flag}<span class="flag-tooltip">${escapeHtml(countryName(item.country))}</span></span>
    <div class="visit-main">
      <div class="visit-id-line">${identity}${appBadge}${clientBadge(item.client)}</div>
      <div class="visit-sub-line"><span class="visit-icons">${icons}</span><span class="visit-stats">${escapeHtml(stats.join(" · "))}</span></div>
      ${contextLine}
    </div>
    <time class="visit-time">${fmtShortDateTime(item.lastAt)}</time>
  </a>`;
}

function renderTable(items: VisitListItem[], registry: MetaKeysRegistry): string {
  if (items.length === 0) return `<p class="muted">No visits match these filters.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i, registry)).join("")}</div>`;
}

/** Pagination/reset links use the canonical `meta.<key>=<value>` querystring
 *  shape — the filter FORM itself submits the simpler fixed `metaKey`/
 *  `metaValue` pair instead (a plain <select>+<input> can't rename its own
 *  `name` to a dynamic `meta.<key>` without client JS); routes/home.ts accepts
 *  both on the way in. */
function buildLink(f: QueryFilters, page: number): string {
  const params = new URLSearchParams();
  if (f.site) params.set("site", f.site);
  if (f.app) params.set("app", f.app);
  if (f.client && f.client !== "human") params.set("client", f.client);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.email) params.set("email", f.email);
  if (f.metaKey && f.metaValue) params.set(`meta.${f.metaKey}`, f.metaValue);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `/${qs ? `?${qs}` : ""}`;
}

function renderPagination(f: QueryFilters, page: number, hasNext: boolean): string {
  const prev = page > 1 ? `<a href="${buildLink(f, page - 1)}">← Prev</a>` : `<span class="muted">← Prev</span>`;
  const next = hasNext ? `<a href="${buildLink(f, page + 1)}">Next →</a>` : `<span class="muted">Next →</span>`;
  return `<nav class="pagination">${prev}<span>Page ${page}</span>${next}</nav>`;
}

export function renderVisitListPage(data: VisitListPageData): string {
  const registry = asMetaKeysRegistry(data.currentSite.metaKeys);
  const body = `${topbar(data.sites, data.currentSite.id)}
<main class="dashboard">
  ${renderSummary(data.summary)}
  ${renderBreakdowns(data.topPages, data.topCountries)}
  ${renderPresets(data.raw, data.rangeDays)}
  ${renderFilterForm(data.raw, registry)}
  ${renderTable(data.items, registry)}
  ${renderPagination(data.raw, data.page, data.hasNext)}
</main>`;
  return renderLayout("Visits", body);
}
