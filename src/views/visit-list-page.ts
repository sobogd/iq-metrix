import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtHM } from "./format";
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
  summary: DaySummary;
  /** Current request URL — the topbar's refresh icon links here to reload. */
  refreshHref: string;
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

/** Scalar stat cards for the selected day — Visits / Events / Identified.
 *  There is deliberately no live number: liveness is per-row, shown as the
 *  green border on sessions that fired in the last ~30 minutes. Cards sit in
 *  one row even on a phone. */
function renderSummary(s: DaySummary): string {
  const cards: Array<{ label: string; value: string }> = [
    { label: "Visits", value: String(s.visits) },
    { label: "Events", value: String(s.events) },
    { label: "Identified", value: String(s.emails) },
  ];
  return `<section class="summary">${cards
    .map(
      (c) => `<div class="stat">
        <span class="stat-value">${escapeHtml(c.value)}</span>
        <span class="stat-label">${escapeHtml(c.label)}</span>
      </div>`,
    )
    .join("")}</section>`;
}

// ---------------------------------------------------------------------------
// Compact visit rows — mixed lines that never wrap (each line truncates
// instead):
//   line 1: GEOGRAPHY as plain text — country flag emoji, country name, and
//           when there is a region or a city a 📍 marker followed by the
//           region, then a comma-separated city (no commas when those parts
//           are missing): "🇪🇸 Spain 📍 California, San Francisco".
//   line 2: the ENTRY ADDRESS — where the session opened, as one full-width
//           purple pill ("/", "/ru/feature-slug"; the coarse page label for
//           pre-path sessions). Truncates to the row width.
//   line 3: the remaining chips, all on ONE line — last-activity time first
//           (HH:MM only — the day lives in the header navigator), then the
//           event count (just the number), then the source ("via <referrer>"
//           / red bot pill when there is no referrer / "from <campaign>"),
//           OS, "Tablet" only when it really is one, theme, language. Chips
//           shrink & ellipsize before wrapping; time and count never shrink.
//   line 4: the email chip — only when the visit is identified; anonymous
//           sessions get no identity line at all.
// A session that fired an event in the last ~30 minutes is STILL LIVE and its
// whole row gets a green border instead of the usual one.
// The whole row links to the visit detail, carrying the day back so
// "← Back to visits" returns to the same day.
// ---------------------------------------------------------------------------

function renderRow(item: VisitListItem, dayKey: string): string {
  // Line 1 — geography as one plain text line: flag + country, then "📍
  // Region, City" when those exist (the comma only appears between region
  // and city, so neither a missing region nor a missing city leaves one
  // dangling). The flag never truncates; the text to its right does.
  const flag = countryEmoji(item.country);
  const country = countryName(item.country);
  const placeParts = [item.region, item.city].filter(Boolean);
  const place = placeParts.length > 0 ? ` 📍 ${placeParts.join(", ")}` : "";
  const geoText = `${country}${place}`;
  const geoRow = `<div class="r-geo"><span class="r-geo-flag">${flag}</span><span class="r-geo-text" title="${escapeHtml(geoText)}">${escapeHtml(geoText)}</span></div>`;

  // Line 2 — the entry address, full width.
  const entryRow = item.firstPage ? `<div class="r-page">${entryChip(item.firstPage)}</div>` : "";

  // Line 3 — everything else. Time leads (HH:MM), then the event count as a
  // bare number, then source chips, OS, device class, theme, language.
  const chips: string[] = [];
  chips.push(chip("tag-muted tag-fixed", fmtHM(item.lastAt)));
  chips.push(chip("tag-count tag-fixed", String(item.eventCount)));
  if (item.ref) {
    chips.push(sourceChip(null, item.ref)); // a real referrer instead of any type tag
  } else {
    if (item.client === "search") chips.push(searchCrawlerChip(item.clientReason));
    else chips.push(clientChip(item.client, item.clientReason));
    if (item.from) chips.push(sourceChip(item.from, null));
  }
  chips.push(osChip(item.os));
  chips.push(deviceChip(item.device));
  chips.push(themeChip(item.theme));
  if (item.lang) chips.push(chip("tag-muted", item.lang));
  const chipsHtml = chips.join("") ? `<div class="r-tags">${chips.join("")}</div>` : "";

  // Anonymous sessions get no identity line at all — nothing is written.
  const idHtml = item.email
    ? `<div class="r-id">${chip("tag-email", item.email)}</div>`
    : "";

  return `
  <a class="visit-row${item.live ? " visit-row-live" : ""}" href="/visits/${escapeHtml(item.id)}?site=${escapeHtml(item.siteId)}&day=${escapeHtml(dayKey)}">
    ${geoRow}
    ${entryRow}
    ${chipsHtml}
    ${idHtml}
  </a>`;
}

function renderTable(items: VisitListItem[], dayKey: string): string {
  if (items.length === 0) return `<p class="muted">No visits on this day.</p>`;
  return `<div class="visits">${items.map((i) => renderRow(i, dayKey)).join("")}</div>`;
}

export function renderVisitListPage(data: VisitListPageData): string {
  const body = `${renderTopbar(data.sites, data.currentSite.id, data.dayKey, data.refreshHref)}
<main class="dashboard">
  ${renderDayNav(data)}
  ${renderSummary(data.summary)}
  ${renderTable(data.items, data.dayKey)}
</main>`;
  return renderLayout("Visits", body);
}
