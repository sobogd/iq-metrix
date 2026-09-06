import type { Site } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import { countryEmoji, countryName, fmtHM } from "./format";
import { clientKindLabel, flat } from "./tags";
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

/** Theme → emoji, shown before the last-activity time on the meta line. */
function themeEmoji(theme: string | null): { emoji: string; label: string } | null {
  if (theme === "dark") return { emoji: "🌙", label: "dark" };
  if (theme === "light") return { emoji: "☀️", label: "light" };
  return null;
}

export interface VisitListPageData {
  sites: Site[];
  currentSite: Site;
  items: VisitListItem[];
  /** Selected Madrid day as "YYYY-MM-DD" — the day the stats and list show.
   *  Picked via the header's 📅 date control; the header shows it as short
   *  text ("7.10.24"), so the page body never repeats the date. */
  dayKey: string;
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
// Day caption — the header's 📅 calendar picks the Madrid day; this quiet
// caption above the stats simply says which day is showing. No arrows, no
// synonyms — the date is the date.
// ---------------------------------------------------------------------------

/** Scalar stat cards for the selected day — Visits / Events / Identified.
 *  There is deliberately no live number: "live" is the green 🟢 dot on rows
 *  with unseen events. Cards sit in one row even on a phone. */
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
//   line 1 — a head row: GEOGRAPHY on the left (flag, country, then
//            "📍 Region, City" when present); on the right the CLIENT as one
//            combined field ("Search engine · Google (IP verified)", muted)
//            for non-human traffic, and the green "new" dot when the session
//            has events the admin has not seen yet. On narrow screens the
//            client drops to its own line under the geography.
//   line 2 — the ENTRY ADDRESS in the page/path purple — where the session
//            opened ("/", "/ru/feature-slug"), one truncated line; only when
//            the visit recorded a pathname.
//   line 3 — dot-separated values, each in its chip color: theme as an emoji
//            (🌙/☀️) right before the last-activity HH:MM, then the event
//            count, OS, "Tablet", language; the via/from source rides inline
//            on wide screens and on its own line on narrow ones.
//   line 4 — the EMAIL in its green, only when the visit is identified.
// The whole row links to the visit detail, carrying the day back so
// "← Back to visits" returns to the same day.
// ---------------------------------------------------------------------------

function renderRow(item: VisitListItem, dayKey: string): string {
  // Line 1 — geography (flag never truncates; the text next to it does), the
  // client field, and the green new-dot, in one responsive head row.
  const flag = countryEmoji(item.country);
  const country = countryName(item.country);
  const placeParts = [item.region, item.city].filter(Boolean);
  const place = placeParts.length > 0 ? ` 📍 ${placeParts.join(", ")}` : "";
  const geoText = `${country}${place}`;
  const geoHtml = `<span class="r-geo"><span class="r-geo-flag">${flag}</span><span class="r-geo-text" title="${escapeHtml(geoText)}">${escapeHtml(geoText)}</span></span>`;
  const kindText = clientKindLabel(item.client, item.clientReason);
  const clientHtml = kindText
    ? `<span class="r-client" title="${escapeHtml(kindText)}">${escapeHtml(kindText)}</span>`
    : "";
  const dotHtml = item.new ? `<span class="r-dot" title="New events">🟢</span>` : "";
  const headRow = `<div class="r-head">${geoHtml}${clientHtml}${dotHtml}</div>`;

  // Line 2 — the entry address, in the page/path purple, no pill.
  const entryRow = item.firstPage
    ? `<div class="r-page" title="${escapeHtml(item.firstPage)}">${flat("page", item.firstPage)}</div>`
    : "";

  // Line 3 — dot-separated colored values; theme is an emoji before HH:MM.
  // The source (via/from) is a separate segment: on a narrow screen it moves
  // to its own line under everything else, on wide screens it stays inline
  // in the same dot-separated line.
  const theme = themeEmoji(item.theme);
  const time = `${theme ? `<span class="r-theme" title="${escapeHtml(theme.label)}">${theme.emoji}</span> ` : ""}${flat("muted", fmtHM(item.lastAt))}`;
  const main: string[] = [time];
  main.push(flat("count", String(item.eventCount)));
  const os = item.os ? OS_LABELS[item.os] : undefined;
  if (os) main.push(flat("os", os));
  if (item.device === "tablet") main.push(flat("device", "Tablet"));
  if (item.lang) main.push(flat("muted", item.lang));
  const srcHtml = item.ref
    ? flat("source", `via ${item.ref}`)
    : item.from
      ? flat("source", `from ${item.from}`)
      : "";
  const metaRow = `<div class="r-meta"><span class="r-meta-main">${main.join(" · ")}</span>${srcHtml ? `<span class="r-meta-src">${srcHtml}</span>` : ""}</div>`;

  // Anonymous sessions get no identity line at all — nothing is written.
  const idHtml = item.email
    ? `<div class="r-id">${flat("email", item.email)}</div>`
    : "";

  return `
  <a class="visit-row" href="/visits/${escapeHtml(item.id)}?site=${escapeHtml(item.siteId)}&day=${escapeHtml(dayKey)}">
    ${headRow}
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
  ${renderSummary(data.summary)}
  ${renderTable(data.items, data.dayKey)}
</main>`;
  return renderLayout("Visits", body);
}
