import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtShortDateTime } from "./format";
import { chip, clientChip, deviceChip, entryChip, osChip, searchCrawlerChip, sourceChip, themeChip } from "./tags";
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
// Compact visit rows — up to three short lines per session:
//   line 1: flag + country · region · city ......... referrer/type pill + evts
//           (the location truncates to one line — full string in the title;
//           a real referrer REPLACES the type tag: green "via <referrer>"
//           chip whenever one exists. Only with no referrer does the type
//           tag show — "search" verdicts get a red "search crawler" pill
//           (the engine's own crawler), ai/preview/bot their plain red pill,
//           humans nothing)
//   line 2: colored TEXT tags (no emoji) — the last-activity time FIRST
//           (the recency anchor), then the ENTRY PAGE — where the session
//           opened, its concrete path ("/", "/ru/feature-slug"; the coarse
//           page label for pre-path sessions) — then OS, "Tablet" only when
//           it really is one, the "from" source, theme, lang. "via
//           <referrer>" never repeats here — line 1 owns it. The
//           session-duration pill is gone from the list; long referrer / geo
//           text truncates instead of spreading the row.
//   line 3: the email tag — only when the visit is identified; anonymous
//           sessions get no line at all.
// No app/landing label — it only confused the list. The whole row links to
// the visit detail.
// ---------------------------------------------------------------------------

function renderRow(item: VisitListItem): string {
  const geo = [countryName(item.country), item.region, item.city].filter(Boolean).join(" · ");

  // Line-1 right edge, before the event count — see the grammar above.
  const clientHtml = item.ref
    ? sourceChip(null, item.ref) // a real referrer instead of any type tag
    : item.client === "search"
      ? searchCrawlerChip(item.clientReason)
      : clientChip(item.client, item.clientReason);

  const tags: string[] = [];
  tags.push(chip("tag-muted", fmtShortDateTime(item.lastAt))); // activity time first
  // The entry page — where the session opened — sits right after the time
  // anchor so "what did this visit look like" reads top-down: when they came
  // in, on what page.
  if (item.firstPage) tags.push(entryChip(item.firstPage));
  tags.push(osChip(item.os));
  tags.push(deviceChip(item.device));
  // "via <ref>" lives on line 1 when a referrer exists — never repeat it in
  // the chip row; here the source chip only ever carries "from <campaign>".
  if (!item.ref) tags.push(sourceChip(item.from, item.ref));
  tags.push(themeChip(item.theme));
  if (item.lang) tags.push(chip("tag-muted", item.lang));
  const tagsHtml = tags.join("")
    ? `<div class="visit-tags">${tags.join("")}</div>`
    : "";

  // Anonymous sessions get no identity line at all — nothing is written.
  const idHtml = item.email ? `<div class="visit-id">${chip("tag-email", item.email)}</div>` : "";

  return `
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}">
    <div class="visit-geo"><span class="visit-flag">${countryEmoji(item.country)}</span><span class="visit-location" title="${escapeHtml(geo)}">${escapeHtml(geo)}</span></div>
    <div class="visit-meta">${clientHtml}<span class="visit-events">${item.eventCount} evt</span></div>
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
