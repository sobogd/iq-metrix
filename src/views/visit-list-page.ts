import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtDuration, fmtShortDateTime } from "./format";
import type { SiteSummary, VisitListItem } from "../lib/visit-queries";

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  items: VisitListItem[];
  page: number;
  hasNext: boolean;
  summary: SiteSummary;
}

export function renderNoSitesPage(): string {
  const body = `${renderTopbar([])}<main class="placeholder">
    <p>⚠️ No sites configured yet.</p>
    <p class="muted">Run <code>npx prisma db seed</code> against this service's database, then reload.</p>
  </main>`;
  return renderLayout("No sites", body);
}

/** Four scalar stat cards — today's summary. Visits / Events / Identified
 *  count the current Madrid calendar day (00:00–23:59 Europe/Madrid); "Live
 *  now" is visitors active in the last few minutes. The day is implicit — no
 *  "today" in the labels. Cards sit in one row even on a phone. */
function renderSummary(s: SiteSummary): string {
  const cards: Array<{ label: string; value: string; live?: boolean }> = [
    { label: "Visits", value: String(s.visitsToday) },
    { label: "Events", value: String(s.eventsToday) },
    { label: "Identified", value: String(s.emailsToday) },
    { label: "Live", value: String(s.liveNow), live: true },
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

// ---------------------------------------------------------------------------
// Compact visit rows — three short lines per session:
//   line 1: flag + country · region · city ......... date/time + event count
//   line 2: colored TEXT tags (no emoji): OS, device class, app, from/via,
//          theme, lang, duration, and the search/AI/bot kind badge
//   line 3: the email tag — only when the visit is identified; anonymous
//          sessions get no line at all.
// The whole row links to the visit detail page.
// ---------------------------------------------------------------------------

const OS_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
};

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

const THEME_LABELS: Record<string, { text: string; cls: string }> = {
  dark: { text: "dark", cls: "tag-theme-dark" },
  light: { text: "light", cls: "tag-theme-light" },
};

/** One colored text pill. All dynamic text is escaped here. */
function chip(cls: string, text: string): string {
  return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

function osChip(os: string | null): string {
  const label = os ? OS_LABELS[os] : undefined;
  return label ? chip("tag-os", label) : "";
}

function deviceChip(device: string | null): string {
  const label = device ? DEVICE_LABELS[device] : undefined;
  return label ? chip("tag-device", label) : "";
}

/** Kind badge for non-human traffic (search/AI/bot); humans get none. */
function kindChip(client: string | null): string {
  if (client !== "search" && client !== "ai" && client !== "bot") return "";
  const label = client === "search" ? "search" : client === "ai" ? "AI" : "bot";
  return `<span class="tag client-${client}">${label}</span>`;
}

function sourceChips(from: string | null, ref: string | null): string {
  const chips: string[] = [];
  if (from) chips.push(chip("tag-source", `from ${from}`));
  if (ref && ref !== from) chips.push(chip("tag-source", `via ${ref}`));
  return chips.join("");
}

function themeChip(theme: string | null): string {
  const t = theme ? THEME_LABELS[theme] : undefined;
  return t ? chip(t.cls, t.text) : "";
}

function renderRow(item: VisitListItem): string {
  const geo = [countryName(item.country), item.region, item.city].filter(Boolean).join(" · ");

  const tags: string[] = [];
  tags.push(osChip(item.os));
  tags.push(deviceChip(item.device));
  if (item.app) tags.push(chip("tag-app", item.app));
  tags.push(sourceChips(item.from, item.ref));
  tags.push(themeChip(item.theme));
  if (item.lang) tags.push(chip("tag-muted", item.lang));
  tags.push(chip("tag-muted", fmtDuration(item.firstAt, item.lastAt)));
  tags.push(kindChip(item.client));
  const tagsHtml = tags.join("")
    ? `<div class="visit-tags">${tags.join("")}</div>`
    : "";

  // Anonymous sessions get no identity line at all — nothing is written.
  const idHtml = item.email ? `<div class="visit-id">${chip("tag-email", item.email)}</div>` : "";

  return `
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}">
    <div class="visit-geo"><span class="visit-flag">${countryEmoji(item.country)}</span><span class="visit-location">${escapeHtml(geo)}</span></div>
    <div class="visit-meta"><time>${fmtShortDateTime(item.lastAt)}</time><span class="visit-events">${item.eventCount} evt</span></div>
    ${tagsHtml}
    ${idHtml}
  </a>`;
}

function renderTable(items: VisitListItem[]): string {
  if (items.length === 0) return `<p class="muted">No visits yet.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i)).join("")}</div>`;
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
  const body = `${renderTopbar(data.sites, data.currentSite.id)}
<main class="dashboard">
  ${renderSummary(data.summary)}
  ${renderTable(data.items)}
  ${renderPagination(data.currentSite.id, data.page, data.hasNext)}
</main>`;
  return renderLayout("Visits", body);
}
