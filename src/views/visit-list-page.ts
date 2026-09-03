import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout } from "./layout";
import { asMetaKeysRegistry, countryEmoji, deviceEmoji, fmtDateTime, renderMetaChips, type MetaKeysRegistry } from "./format";
import { renderRankedBars, renderTimeSeriesBars, type ChartPoint } from "../lib/svg-chart";
import type { QueryFilters, VisitListItem } from "../lib/visit-queries";

export interface VisitListCharts {
  visitsPerDay: ChartPoint[];
  topCountries: ChartPoint[];
  deviceBreakdown: ChartPoint[];
  topPages: ChartPoint[];
}

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  raw: QueryFilters;
  items: VisitListItem[];
  page: number;
  hasNext: boolean;
  charts: VisitListCharts;
}

function topbar(): string {
  return `
<header class="topbar">
  <h1>📊 iq-metrix</h1>
  <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
</header>`;
}

export function renderNoSitesPage(): string {
  const body = `${topbar()}<main class="placeholder">
    <p>⚠️ No sites configured yet.</p>
    <p class="muted">Run <code>npx prisma db seed</code> against this service's database, then reload.</p>
  </main>`;
  return renderLayout("No sites", body);
}

function renderFilterForm(sites: Site[], f: QueryFilters, registry: MetaKeysRegistry): string {
  const siteOptions = sites
    .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === f.site ? " selected" : ""}>${escapeHtml(s.id)}</option>`)
    .join("");
  const metaKeyOptions = [
    `<option value="">— any —</option>`,
    ...Object.entries(registry).map(([key, cfg]) => {
      const label = typeof cfg.label === "string" ? cfg.label : key;
      return `<option value="${escapeHtml(key)}"${key === f.metaKey ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }),
  ].join("");

  return `
  <form class="filters" method="get" action="/">
    <label>Site
      <select name="site">${siteOptions}</select>
    </label>
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

function renderCharts(charts: VisitListCharts): string {
  return `
  <div class="charts">
    <div class="chart-card chart-wide">
      <h3>📈 Visits per day <span class="muted">(30d)</span></h3>
      ${renderTimeSeriesBars(charts.visitsPerDay, { width: 640, height: 120 })}
    </div>
    <div class="chart-card">
      <h3>🌍 Top countries</h3>
      ${renderRankedBars(charts.topCountries)}
    </div>
    <div class="chart-card">
      <h3>📱 Device breakdown</h3>
      ${renderRankedBars(charts.deviceBreakdown)}
    </div>
    <div class="chart-card">
      <h3>📄 Top pages</h3>
      ${renderRankedBars(charts.topPages)}
    </div>
  </div>`;
}

const HEAD_CELLS = ["🕐 When", "📱 Device", "🌍 Location", "👤 Identity", "🧩 App", "🔢 Events", "📄 First page", "🏷️ Meta", ""];

function renderHead(): string {
  return `<div class="viz-row viz-head">${HEAD_CELLS.map((h) => `<span class="viz-cell">${h}</span>`).join("")}</div>`;
}

function renderRow(item: VisitListItem, registry: MetaKeysRegistry): string {
  const identity = item.email ? `✉️ ${escapeHtml(item.email)}` : `👻 anon`;
  const device = `${deviceEmoji(item.device)} ${escapeHtml(item.os ?? "—")}`;
  const location = `${countryEmoji(item.country)} ${escapeHtml(item.country)}${item.city ? ` · ${escapeHtml(item.city)}` : ""}`;
  const when = `${fmtDateTime(item.firstAt)} <span class="muted">→</span> ${fmtDateTime(item.lastAt)}`;
  return `
  <div class="viz-row">
    <span class="viz-cell" data-label="When">${when}</span>
    <span class="viz-cell" data-label="Device">${device}</span>
    <span class="viz-cell" data-label="Location">${location}</span>
    <span class="viz-cell" data-label="Identity">${identity}</span>
    <span class="viz-cell" data-label="App">${item.app ? escapeHtml(item.app) : `<span class="muted">—</span>`}</span>
    <span class="viz-cell" data-label="Events">${item.eventCount}</span>
    <span class="viz-cell" data-label="First page">${item.firstPage ? escapeHtml(item.firstPage) : `<span class="muted">—</span>`}</span>
    <span class="viz-cell" data-label="Meta">${renderMetaChips(item.meta, registry)}</span>
    <span class="viz-cell" data-label="">🔎 <a href="/visits/${escapeHtml(item.id)}">View</a></span>
  </div>`;
}

function renderTable(items: VisitListItem[], registry: MetaKeysRegistry): string {
  if (items.length === 0) return `<p class="muted">No visits match these filters.</p>`;
  return `<div class="viz">${renderHead()}${items.map((i) => renderRow(i, registry)).join("")}</div>`;
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
  const body = `${topbar()}
<main class="dashboard">
  ${renderFilterForm(data.sites, data.raw, registry)}
  ${renderCharts(data.charts)}
  ${renderTable(data.items, registry)}
  ${renderPagination(data.raw, data.page, data.hasNext)}
</main>`;
  return renderLayout("Visits", body);
}
