import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtHM } from "./format";
import { clientKindLabel } from "./tags";
import type { DaySummary, VisitListItem } from "../lib/visit-queries";

// The row renders as plain text everywhere — no pills. Each value keeps the
// COLOR its chip used to carry (see .r-t-* rules in style.css); the pill
// background/border is gone.
const OS_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
};

const THEME_CLS: Record<string, string> = {
  dark: "theme-dark",
  light: "theme-light",
};

/** One colored-text segment — chip color, no pill. */
function t(cls: string, text: string): string {
  return `<span class="r-t-${cls}">${escapeHtml(text)}</span>`;
}

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
// Compact visit rows — plain text lines, no pills anywhere (only the chip
// COLORS remain, see .r-t-* in style.css):
//   line 1: GEOGRAPHY — country flag emoji, country name, then, when there
//           is a region or a city, "📍 Region, City" (no commas dangle when
//           a part is missing): "🇪🇸 Spain 📍 California, San Francisco".
//   line 2: the CLIENT — one combined field (verdict + reason in a single
//           readable line, "Search engine · Google (IP verified)") in muted
//           text — humans get no line at all.
//   line 3: the ENTRY ADDRESS in the page/path purple — where the session
//           opened ("/", "/ru/feature-slug"), one truncated line. Only shown
//           when the visit recorded a pathname — sessions from before path
//           capture get no address line at all (no bare type labels).
//   line 4: everything else as dot-separated text, each value keeping its
//           chip color: last-activity HH:MM (the day lives in the header
//           navigator), the event count, via/from source, OS, "Tablet",
//           theme, language — wraps if it has to.
//   line 5: the EMAIL in its green, only when the visit is identified.
// A session that fired an event in the last ~30 minutes is STILL LIVE and its
// whole row gets a green border instead of the usual one.
// The whole row links to the visit detail, carrying the day back so
// "← Back to visits" returns to the same day.
// ---------------------------------------------------------------------------

function renderRow(item: VisitListItem, dayKey: string): string {
  // Line 1 — geography as one plain text line: flag + country, then "📍
  // Region, City" when those exist. The flag never truncates; the text next
  // to it does (full value in the title).
  const flag = countryEmoji(item.country);
  const country = countryName(item.country);
  const placeParts = [item.region, item.city].filter(Boolean);
  const place = placeParts.length > 0 ? ` 📍 ${placeParts.join(", ")}` : "";
  const geoText = `${country}${place}`;
  const geoRow = `<div class="r-geo"><span class="r-geo-flag">${flag}</span><span class="r-geo-text" title="${escapeHtml(geoText)}">${escapeHtml(geoText)}</span></div>`;

  // Line 2 — the client as one combined field (kind + reason in a single
  // readable line). Empty for humans — a real visitor needs no annotation.
  const kindText = clientKindLabel(item.client, item.clientReason);
  const clientRow = kindText ? `<div class="r-client">${escapeHtml(kindText)}</div>` : "";

  // Line 3 — the entry address, in the page/path purple, no pill.
  const entryRow = item.firstPage
    ? `<div class="r-page" title="${escapeHtml(item.firstPage)}">${t("page", item.firstPage)}</div>`
    : "";

  // Line 4 — everything else, dot-separated, each piece in its chip color.
  const meta: string[] = [];
  meta.push(t("muted", fmtHM(item.lastAt)));
  meta.push(t("count", String(item.eventCount)));
  if (item.ref) meta.push(t("source", `via ${item.ref}`));
  else if (item.from) meta.push(t("source", `from ${item.from}`));
  const os = item.os ? OS_LABELS[item.os] : undefined;
  if (os) meta.push(t("os", os));
  if (item.device === "tablet") meta.push(t("device", "Tablet"));
  const themeCls = item.theme ? THEME_CLS[item.theme] : undefined;
  if (themeCls) meta.push(t(themeCls, item.theme!));
  if (item.lang) meta.push(t("muted", item.lang));
  const metaRow = meta.length > 0 ? `<div class="r-meta">${meta.join(" · ")}</div>` : "";

  // Anonymous sessions get no identity line at all — nothing is written.
  const idHtml = item.email
    ? `<div class="r-id">${t("email", item.email)}</div>`
    : "";

  return `
  <a class="visit-row${item.live ? " visit-row-live" : ""}" href="/visits/${escapeHtml(item.id)}?site=${escapeHtml(item.siteId)}&day=${escapeHtml(dayKey)}">
    ${geoRow}
    ${clientRow}
    ${entryRow}
    ${metaRow}
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
