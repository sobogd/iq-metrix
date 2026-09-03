import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout } from "./layout";
import {
  asMetaKeysRegistry,
  countryEmoji,
  countryName,
  deviceTypeEmoji,
  fmtShortDateTime,
  osEmoji,
  themeEmoji,
  type MetaKeysRegistry,
} from "./format";
import type { QueryFilters, VisitListItem } from "../lib/visit-queries";

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  raw: QueryFilters;
  items: VisitListItem[];
  page: number;
  hasNext: boolean;
}

function topbar(sites: Site[], currentSiteId?: string): string {
  const siteLinks = sites
    .map((s) => `<a href="/?site=${escapeHtml(s.id)}" class="site-link${s.id === currentSiteId ? " active" : ""}">${escapeHtml(s.id)}</a>`)
    .join("");
  return `
<header class="topbar">
  <h1>📊 iq-metrix</h1>
  ${siteLinks ? `<nav class="site-nav">${siteLinks}</nav>` : ""}
  <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
</header>`;
}

export function renderNoSitesPage(): string {
  const body = `${topbar([])}<main class="placeholder">
    <p>⚠️ No sites configured yet.</p>
    <p class="muted">Run <code>npx prisma db seed</code> against this service's database, then reload.</p>
  </main>`;
  return renderLayout("No sites", body);
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

function renderRow(item: VisitListItem): string {
  const flag = countryEmoji(item.country);
  const refSource = item.from || item.ref;
  const ref = refSource
    ? `<span class="visit-ref" title="${escapeHtml(refSource)}">${escapeHtml(refSource)}</span>`
    : "";
  return `
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}">
    <span class="flag-wrap">${flag}<span class="flag-tooltip">${escapeHtml(countryName(item.country))}</span></span>
    <span class="visit-time">${fmtShortDateTime(item.lastAt)}</span>
    <span class="visit-icon">${deviceTypeEmoji(item.device)}</span>
    <span class="visit-icon">${osEmoji(item.os)}</span>
    <span class="visit-icon">${themeEmoji(item.theme)}</span>
    <span class="visit-icon">${item.email ? "👤" : "👻"}</span>
    ${ref}
  </a>`;
}

function renderTable(items: VisitListItem[]): string {
  if (items.length === 0) return `<p class="muted">No visits match these filters.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i)).join("")}</div>`;
}

/** Pagination/reset links use the canonical `meta.<key>=<value>` querystring
 *  shape (the /ingest contract's shape re-used for the UI, per the task) —
 *  the filter FORM itself submits the simpler fixed `metaKey`/`metaValue`
 *  pair instead (a plain <select>+<input> can't rename its own `name` to a
 *  dynamic `meta.<key>` without client JS); routes/home.ts accepts both on
 *  the way in. */
function buildLink(f: QueryFilters, page: number): string {
  const params = new URLSearchParams();
  if (f.site) params.set("site", f.site);
  if (f.app) params.set("app", f.app);
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
  ${renderFilterForm(data.raw, registry)}
  ${renderTable(data.items)}
  ${renderPagination(data.raw, data.page, data.hasNext)}
</main>`;
  return renderLayout("Visits", body);
}
