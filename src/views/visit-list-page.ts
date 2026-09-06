import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtShortDateTime } from "./format";
import { chip, clientChip, deviceChip, entryChip, osChip, searchCrawlerChip, sourceChip, themeChip } from "./tags";
import type { DaySummary, VisitListItem } from "../lib/visit-queries";

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  items: VisitListItem[];
  /** Selected Madrid day as "YYYY-MM-DD" — the day the stats and list show. */
  dayKey: string;
  /** Same day as "Today" / "Yesterday", else "Fri, 04 Sep" (+ year when not
   *  the current one) — computed on the Madrid clock. */
  heading: string;
  /** Neighbouring days for the arrows, and today's key for the heading link. */
  prevKey: string;
  nextKey: string;
  todayKey: string;
  /** Next arrow is disabled once the selected day IS today — no future days. */
  canNext: boolean;
  /** Live card only means something for the current day. */
  isToday: boolean;
  summary: DaySummary;
  live: number;
}

export function renderNoSitesPage(): string {
  const body = `${renderTopbar([])}<main class="placeholder">
    <p>⚠️ No sites configured yet.</p>
    <p class="muted">Run <code>npx prisma db seed</code> against this service's database, then reload.</p>
  </main>`;
  return renderLayout("No sites", body);
}

// ---------------------------------------------------------------------------
// Day navigator — sits above the summary. One Madrid calendar day per page:
// left/right arrows step a day at a time, the heading names the day ("Today",
// "Yesterday", else a date) and, when it isn't today, doubles as a "back to
// today" link. There is no lower bound — past days are all reachable; the
// future is not (next is disabled on today).
// ---------------------------------------------------------------------------

function renderDayNav(data: Pick<VisitListPageData, "currentSite" | "dayKey" | "heading" | "prevKey" | "nextKey" | "todayKey" | "canNext">): string {
  const base = (key: string) => `/?site=${escapeHtml(data.currentSite.id)}&day=${escapeHtml(key)}`;
  const next = data.canNext
    ? `<a class="day-btn" href="${base(data.nextKey)}" aria-label="Next day">→</a>`
    : `<span class="day-btn day-btn-off" aria-hidden="true">→</span>`;
  const heading = data.dayKey === data.todayKey
    ? `<span class="day-heading">${escapeHtml(data.heading)}</span>`
    : `<a class="day-heading" href="${base(data.todayKey)}" title="Back to today">${escapeHtml(data.heading)}</a>`;
  return `
  <nav class="daynav" aria-label="Pick a day">
    <a class="day-btn" href="${base(data.prevKey)}" aria-label="Previous day">←</a>
    ${heading}
    ${next}
  </nav>`;
}

/** Scalar stat cards for the selected day — Visits / Events / Identified,
 *  plus "Live" only when the day is the current one (it is a now-measure).
 *  Cards sit in one row even on a phone; the grid column count follows the
 *  card count (3 or 4) so dropping Live on a past day leaves no empty cell. */
function renderSummary(s: DaySummary, live: number, isToday: boolean): string {
  const cards: Array<{ label: string; value: string; live?: boolean }> = [
    { label: "Visits", value: String(s.visits) },
    { label: "Events", value: String(s.events) },
    { label: "Identified", value: String(s.emails) },
  ];
  if (isToday) cards.push({ label: "Live", value: String(live), live: true });
  return `<section class="summary" style="grid-template-columns: repeat(${cards.length}, 1fr)">${cards
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
// the visit detail, carrying the day back so "← Back to visits" returns to
// the same day.
// ---------------------------------------------------------------------------

function renderRow(item: VisitListItem, dayKey: string): string {
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
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}?site=${escapeHtml(item.siteId)}&day=${escapeHtml(dayKey)}">
    <div class="visit-geo"><span class="visit-flag">${countryEmoji(item.country)}</span><span class="visit-location" title="${escapeHtml(geo)}">${escapeHtml(geo)}</span></div>
    <div class="visit-meta">${clientHtml}<span class="visit-events">${item.eventCount} evt</span></div>
    ${tagsHtml}
    ${idHtml}
  </a>`;
}

function renderTable(items: VisitListItem[], dayKey: string): string {
  if (items.length === 0) return `<p class="muted">No visits on this day.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i, dayKey)).join("")}</div>`;
}

export function renderVisitListPage(data: VisitListPageData): string {
  const body = `${renderTopbar(data.sites, data.currentSite.id, data.dayKey)}
<main class="dashboard">
  ${renderDayNav(data)}
  ${renderSummary(data.summary, data.live, data.isToday)}
  ${renderTable(data.items, data.dayKey)}
</main>`;
  return renderLayout("Visits", body);
}
