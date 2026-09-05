import type { Event, Site, Visit } from "@prisma/client";
import { escapeHtml, renderLayout, renderTopbar } from "./layout";
import {
  asMetaKeysRegistry,
  coerceMeta,
  countryEmoji,
  countryName,
  fmtClock,
  fmtDayLabel,
  fmtDateTime,
  fmtDuration,
  fmtMadridDay,
  fmtVisitRange,
  renderMetaChips,
} from "./format";
import { chip, clientChip, deviceChip, osChip, sourceChip, themeChip } from "./tags";

// Separate page (GET /visits/:id), not a <dialog> opened from the list row.
// Picked over a dialog because this app deliberately has no client JS
// beyond the header's one-line domain-dropdown onchange: a native <dialog>
// needs `.showModal()` (or the very new, not-yet-universal
// popover/command-invoker attributes) to open, so "no JS framework" would
// have quietly become "a few lines of vanilla JS, plus a no-JS fallback for
// when it's disabled". A plain link to a plain page needs neither — it also
// gets a real URL (bookmarkable, shareable, opens in a new tab), works with
// the browser's own back button for free, and is one <a href> away from
// every other server-rendered page in this app instead of a one-off pattern.

export function renderVisitNotFoundPage(sites: Site[]): string {
  const body = `${renderTopbar(sites)}<main class="placeholder">
    <p>⚠️ Visit not found.</p>
    <p><a href="/">← Back to visits</a></p>
  </main>`;
  return renderLayout("Not found", body);
}

function kv(label: string, value: string): string {
  return `<div class="kv"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
}

/** <code> that truncates with an ellipsis but keeps the full value in a
 *  tooltip — long hex ids would otherwise blow the row width. */
function kvCode(label: string, value: string, keep = 24): string {
  const shown = value.length > keep ? `${value.slice(0, keep)}…` : value;
  return kv(label, `<code title="${escapeHtml(value)}">${escapeHtml(shown)}</code>`);
}

// ---------------------------------------------------------------------------
// Session head — deliberately the SAME grammar as a sessions-list row
// (visit-list-page.ts): location + activity-window on the first line, then a
// wrap-around row of colored attribute chips, then the identity (email) chip.
// The verbose id/key/hash rows that used to live in a tall label grid are
// folded into a collapsed native <details> below the head — no JS needed.
// ---------------------------------------------------------------------------

/** Chips for the head's tag row. Order matches the list rows: app (when the
 *  site uses sub-apps), OS, tablet, via/from source, theme, lang, then the
 *  activity-window length (the list swaps that pill for the last-activity
 *  time on line 2, and keeps the client pill on line 1 before the event
 *  count); the red non-human pill closes the head's own tag row. */
function renderHeadTags(visit: Visit): string {
  const tags: string[] = [];
  if (visit.app) tags.push(chip("tag-muted", visit.app));
  tags.push(osChip(visit.os));
  tags.push(deviceChip(visit.device));
  tags.push(sourceChip(visit.from, visit.ref));
  tags.push(themeChip(visit.theme));
  if (visit.lang) tags.push(chip("tag-muted", visit.lang));
  tags.push(chip("tag-muted", fmtDuration(visit.firstAt, visit.lastAt)));
  tags.push(clientChip(visit.client, visit.clientReason));
  return `<div class="visit-tags">${tags.join("")}</div>`;
}

/** One-line compact head card. Everything at-a-glance about the session;
 *  ids and hashes live in the collapsed <details> below instead. */
function renderSessionHead(visit: Visit, eventsCount: number, metaBlock: string): string {
  const geo = [countryName(visit.country), visit.region, visit.city].filter(Boolean).join(" · ");
  const rangeTitle = `${fmtDayLabel(visit.firstAt)}, ${fmtClock(visit.firstAt)} → ${fmtDayLabel(visit.lastAt)}, ${fmtClock(visit.lastAt)} · Europe/Madrid`;
  const idHtml = visit.email
    ? `<div class="visit-id">${chip("tag-email", visit.email)}</div>`
    : "";

  return `
  <section class="session-head">
    <div class="visit-geo"><span class="visit-flag">${countryEmoji(visit.country)}</span><span class="visit-location">${escapeHtml(geo)}</span></div>
    <div class="visit-meta"><time title="${escapeHtml(rangeTitle)}">${escapeHtml(fmtVisitRange(visit.firstAt, visit.lastAt))}</time><span class="visit-events">${eventsCount} evt</span></div>
    ${renderHeadTags(visit)}
    ${idHtml}
    ${metaBlock}
  </section>`;
}

/** Collapsed "everything else" — verbose rows that would only add noise to
 *  the compact head: exact timestamps, attribution raw values, the bot
 *  verdict, and the internal visit/key/hash identifiers. */
function renderRawDetails(visit: Visit): string {
  const fields = [
    kv("First seen", fmtDateTime(visit.firstAt)),
    kv("Last seen", fmtDateTime(visit.lastAt)),
    kv("From", escapeHtml(visit.from ?? "—")),
    kv("Referrer", escapeHtml(visit.ref ?? "—")),
    kv("Client kind", escapeHtml(visit.client ?? "—")),
    visit.clientReason ? kv("Client reason", escapeHtml(visit.clientReason)) : "",
    kv("Merged anonymous visits", String(visit.mergeCount)),
    kv("Visit id", `<code>${escapeHtml(visit.id)}</code>`),
    kvCode("Visit key", visit.visitKey),
    kvCode("Device hash", visit.hash),
  ].join("");
  return `<details class="raw"><summary>Session ids &amp; exact timestamps</summary><div class="kv-grid">${fields}</div></details>`;
}

/** Latest meta snapshot block for the session head — shared by the detail
 *  page and the delete-confirm page so both always show the same session. */
function renderMetaBlock(visit: Visit, registry: ReturnType<typeof asMetaKeysRegistry>): string {
  const meta = coerceMeta(visit.meta);
  return Object.keys(meta).length > 0
    ? `<div class="meta-block"><span class="k">Meta snapshot</span><div>${renderMetaChips(meta, registry)}</div></div>`
    : "";
}

// ---------------------------------------------------------------------------
// Event stream — one compact row per event, ordered by time. The visible
// time (HH:MM:SS) is the ordering anchor; page / action / name flow inline
// as chips + text, and locale/app/meta ride at the end of the same line so a
// session reads as a single scannable sequence instead of stacked cards.
// ---------------------------------------------------------------------------

// Action verbs worth calling out in color while scanning the funnel.
const INTERACT_ACTIONS = new Set([
  "Click", "Tap", "Focus", "Type", "Select", "Choose", "Submit", "Toggle",
  "Change", "Drag", "Hover", "Edit", "Search", "Copy", "Switch", "Open",
  "Close", "Enter", "Send", "Currency",
]);
const CONVERT_ACTIONS = new Set([
  "Register", "Sign up", "Signup", "Login", "Sign in", "Subscribe",
  "Purchase", "Pay", "Checkout", "Upgrade", "Convert",
]);

function actionChip(action: string): string {
  const cls = CONVERT_ACTIONS.has(action)
    ? "tag-convert"
    : INTERACT_ACTIONS.has(action)
      ? "tag-interact"
      : "tag-muted";
  return chip(cls, action);
}

function renderEvent(e: Event, registry: ReturnType<typeof asMetaKeysRegistry>): string {
  const meta = coerceMeta(e.meta);
  const extra: string[] = [];
  if (e.locale) extra.push(chip("tag-muted", e.locale));
  if (e.app) extra.push(chip("tag-muted", e.app));
  if (Object.keys(meta).length > 0) extra.push(renderMetaChips(meta, registry));

  const full = `${fmtDayLabel(e.at)}, ${fmtClock(e.at)} · Europe/Madrid`;
  return `
  <div class="evt">
    <time class="evt-time" datetime="${escapeHtml(e.at.toISOString())}" title="${escapeHtml(full)}">${fmtClock(e.at)}</time>
    <div class="evt-body">
      <span class="tag tag-page">${escapeHtml(e.page)}</span>
      ${actionChip(e.action)}
      <span class="evt-name">${escapeHtml(e.name)}</span>
      ${extra.join("")}
    </div>
  </div>`;
}

function renderEvents(events: Event[], registry: ReturnType<typeof asMetaKeysRegistry>): string {
  if (events.length === 0) return `<p class="muted">No events recorded.</p>`;
  const rows: string[] = [];
  // Day dividers appear only when the stream crosses into a new Madrid
  // calendar day — a single-day session needs no label (the head already
  // shows the window).
  let prevDay: string | null = null;
  for (const e of events) {
    const day = fmtMadridDay(e.at);
    if (prevDay !== null && day !== prevDay) {
      rows.push(`<div class="evt-day">${escapeHtml(fmtDayLabel(e.at))}</div>`);
    }
    prevDay = day;
    rows.push(renderEvent(e, registry));
  }
  return `<div class="evt-list">${rows.join("")}</div>`;
}

export function renderVisitDetailPage(visit: Visit, events: Event[], site: Site | null, sites: Site[]): string {
  const registry = asMetaKeysRegistry(site?.metaKeys);

  const body = `${renderTopbar(sites, visit.siteId)}
<main class="dashboard">
  <p class="crumb"><a href="/?site=${escapeHtml(visit.siteId)}">← Back to visits</a></p>
  ${renderSessionHead(visit, events.length, renderMetaBlock(visit, registry))}
  ${renderRawDetails(visit)}
  <section>
    <h2>Events (${events.length})</h2>
    ${renderEvents(events, registry)}
  </section>
  <div class="detail-actions">
    <a class="danger-link" href="/visits/${escapeHtml(visit.id)}/delete">Delete session</a>
  </div>
</main>`;
  return renderLayout(`Visit ${visit.id}`, body);
}

// ---------------------------------------------------------------------------
// Delete-confirm page (GET /visits/:id/delete, POST executes). Destructive
// and irreversible, so no-JS app gets no one-click delete: the session head
// is re-rendered exactly as on the detail page so the admin sees precisely
// what will be removed, and only the POST form on THIS page actually deletes
// (the detail-page link is just a GET to here — it changes nothing). The
// POST handler then redirects back to the site's session list.
// ---------------------------------------------------------------------------

export function renderVisitDeletePage(visit: Visit, eventsCount: number, site: Site | null, sites: Site[]): string {
  const registry = asMetaKeysRegistry(site?.metaKeys);
  const plural = eventsCount === 1 ? "event" : "events";
  const body = `${renderTopbar(sites, visit.siteId)}
<main class="dashboard">
  <p class="crumb"><a href="/visits/${escapeHtml(visit.id)}">← Back to session</a></p>
  ${renderSessionHead(visit, eventsCount, renderMetaBlock(visit, registry))}
  <section class="confirm">
    <h2>Delete this session?</h2>
    <p class="muted">The session above and its ${eventsCount} ${plural} will be permanently removed from
      ${escapeHtml(visit.siteId)}. This can't be undone.</p>
    <div class="confirm-actions">
      <a class="cancel-btn" href="/visits/${escapeHtml(visit.id)}">Cancel</a>
      <form method="post" action="/visits/${escapeHtml(visit.id)}/delete">
        <button class="delete-btn" type="submit">Delete session</button>
      </form>
    </div>
  </section>
</main>`;
  return renderLayout(`Delete ${visit.id}`, body);
}
