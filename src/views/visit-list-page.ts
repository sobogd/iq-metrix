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
import type { SiteSummary, VisitListItem } from "../lib/visit-queries";

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  items: VisitListItem[];
  page: number;
  hasNext: boolean;
  summary: SiteSummary;
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

/** Four scalar stat cards — today's summary. Visits / Events / Identified
 *  count the current Madrid calendar day (00:00–23:59 Europe/Madrid); "Live
 *  now" is visitors active in the last few minutes. No charts, no top
 *  rankings, no filters — the numbers are the page's headline. */
function renderSummary(s: SiteSummary): string {
  const cards: Array<{ label: string; value: string; live?: boolean }> = [
    { label: "Visits · today", value: String(s.visitsToday) },
    { label: "Events · today", value: String(s.eventsToday) },
    { label: "Identified · today", value: String(s.emailsToday) },
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

/** Small label for non-human traffic; empty for humans/legacy. */
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
  if (items.length === 0) return `<p class="muted">No visits yet.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i, registry)).join("")}</div>`;
}

function buildLink(siteId: string, page: number): string {
  const params = new URLSearchParams();
  params.set("site", siteId);
  if (page > 1) params.set("page", String(page));
  return `/?${params.toString()}`;
}

function renderPagination(siteId: string, page: number, hasNext: boolean): string {
  const prev = page > 1 ? `<a href="${buildLink(siteId, page - 1)}">← Prev</a>` : `<span class="muted">← Prev</span>`;
  const next = hasNext ? `<a href="${buildLink(siteId, page + 1)}">Next →</a>` : `<span class="muted">Next →</span>`;
  return `<nav class="pagination">${prev}<span>Page ${page}</span>${next}</nav>`;
}

export function renderVisitListPage(data: VisitListPageData): string {
  const registry = asMetaKeysRegistry(data.currentSite.metaKeys);
  const body = `${topbar(data.sites, data.currentSite.id)}
<main class="dashboard">
  ${renderSummary(data.summary)}
  ${renderTable(data.items, registry)}
  ${renderPagination(data.currentSite.id, data.page, data.hasNext)}
</main>`;
  return renderLayout("Visits", body);
}
