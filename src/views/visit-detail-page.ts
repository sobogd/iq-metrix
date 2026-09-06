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
import { chip, clientChip, clientKindLabel, deviceChip, flat, osChip, sourceChip, themeChip } from "./tags";

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

/** "&day=YYYY-MM-DD" query suffix when the admin came from a specific Madrid
 *  day in the list — the back links keep them on that day. */
function dayQuery(dayKey?: string): string {
  return dayKey ? `&day=${escapeHtml(dayKey)}` : "";
}

export function renderVisitNotFoundPage(sites: Site[], dayKey?: string, refreshHref?: string): string {
  const back = dayKey ? `/?day=${escapeHtml(dayKey)}` : "/";
  const body = `${renderTopbar(sites, undefined, dayKey, refreshHref)}<main class="placeholder">
    <p>⚠️ Visit not found.</p>
    <p><a href="${back}">← Back to visits</a></p>
  </main>`;
  return renderLayout("Not found", body);
}

// ---------------------------------------------------------------------------
// Session head — its own compact card (kept in the old chip grammar):
// location text + activity window and event count on the first line, then a
// wrap-around row of attribute chips, then the identity (email) chip. The
// sessions list and the events below on this page use the flat-text grammar
// (visit-list-page.ts / the event cards further down); only the chip
// vocabulary (tags.ts) is shared. The verbose id/key/hash rows that used to
// live in a tall label grid are folded into a collapsed native <details>
// below the head — no JS needed.
// ---------------------------------------------------------------------------

/** Chips for the head's tag row: app (when the site uses sub-apps), OS,
 *  tablet, via/from source, theme, lang, then the activity-window length;
 *  the red non-human pill closes the head's own tag row. */
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

/** Latest meta snapshot block for the session head — shared by the detail
 *  page and the delete-confirm page so both always show the same session. */
function renderMetaBlock(visit: Visit, registry: ReturnType<typeof asMetaKeysRegistry>): string {
  const meta = coerceMeta(visit.meta);
  return Object.keys(meta).length > 0
    ? `<div class="meta-block"><span class="k">Meta snapshot</span><div>${renderMetaChips(meta, registry)}</div></div>`
    : "";
}

// ---------------------------------------------------------------------------
// Event list — every event is a card in EXACTLY the sessions-list row layout
// (visit-list-page.ts): plain flat text at 14px, chip colors only, newest
// event FIRST. One card per event:
//   line 1 — head: the event name (semibold, grows) with the action verb at
//            the right in its funnel color (interaction blue / conversion
//            gold / muted);
//   line 2 — the page the event happened on, in the page/path purple — shown
//            only when the event carries a pathname;
//   line 3 — dot-separated meta: time HH:MM:SS, locale, app, meta values.
// A Madrid-day divider appears when the stream crosses into the previous day.
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

function actionCls(action: string): string {
  if (CONVERT_ACTIONS.has(action)) return "convert";
  if (INTERACT_ACTIONS.has(action)) return "interact";
  return "muted";
}

/** Per-event meta as flat text (links stay links — the {v} admin links). */
function flatMeta(meta: Record<string, string>, registry: ReturnType<typeof asMetaKeysRegistry>): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    const cfg = registry[key];
    const label = typeof cfg?.label === "string" ? cfg.label : key;
    const text = `${label}: ${value}`;
    if (typeof cfg?.link === "string" && cfg.link.includes("{v}")) {
      const href = cfg.link.replace("{v}", encodeURIComponent(value));
      parts.push(`<a class="r-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`);
    } else {
      parts.push(flat("muted", text));
    }
  }
  return parts;
}

function renderEvent(e: Event, registry: ReturnType<typeof asMetaKeysRegistry>): string {
  const full = `${fmtDayLabel(e.at)}, ${fmtClock(e.at)} · Europe/Madrid`;

  const head = `<div class="r-head"><span class="evt-name">${escapeHtml(e.name)}</span>${flat(actionCls(e.action), e.action)}</div>`;
  const page = e.path
    ? `<div class="r-page" title="${escapeHtml(e.path)}">${flat("page", e.path)}</div>`
    : "";

  const meta: string[] = [
    `<span class="r-t-muted" title="${escapeHtml(full)}">${fmtClock(e.at)}</span>`,
  ];
  if (e.locale) meta.push(flat("muted", e.locale));
  if (e.app) meta.push(flat("muted", e.app));
  meta.push(...flatMeta(coerceMeta(e.meta), registry));

  return `
  <div class="visit-row">
    ${head}
    ${page}
    <div class="r-meta">${meta.join(" · ")}</div>
  </div>`;
}

/** One kv row — label left, value right, full width (the expander lists one
 *  field per row). `value` is trusted HTML (escaping done by callers). */
function kvRow(label: string, value: string): string {
  return `<div class="kv"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
}

/** The whole session's information as one always-visible block — one field
 *  per row, so the page reads: back/delete icons, the Session info block,
 *  then the events list as the main content. */
function renderSessionInfo(
  visit: Visit,
  eventsCount: number,
  registry: ReturnType<typeof asMetaKeysRegistry>,
): string {
  const rows: string[] = [];

  const location: string[] = [];
  location.push(kvRow("Country", `${countryEmoji(visit.country)} ${escapeHtml(countryName(visit.country))}`));
  if (visit.region) location.push(kvRow("Region", escapeHtml(visit.region)));
  if (visit.city) location.push(kvRow("City", escapeHtml(visit.city)));

  rows.push(...location);
  rows.push(kvRow("First seen", escapeHtml(fmtDateTime(visit.firstAt))));
  rows.push(kvRow("Last seen", escapeHtml(fmtDateTime(visit.lastAt))));
  rows.push(kvRow("Events", String(eventsCount)));
  if (visit.app) rows.push(kvRow("App", escapeHtml(visit.app)));
  if (visit.os) rows.push(kvRow("OS", escapeHtml(visit.os)));
  if (visit.device === "tablet") rows.push(kvRow("Device", "Tablet"));
  if (visit.lang) rows.push(kvRow("Language", escapeHtml(visit.lang)));
  if (visit.theme) {
    const theme = visit.theme === "dark" ? "🌙 dark" : visit.theme === "light" ? "☀️ light" : visit.theme;
    rows.push(kvRow("Theme", escapeHtml(theme)));
  }
  if (visit.ref) rows.push(kvRow("Referrer", escapeHtml(visit.ref)));
  if (visit.from) rows.push(kvRow("From", escapeHtml(visit.from)));
  if (visit.email) rows.push(kvRow("Email", escapeHtml(visit.email)));
  rows.push(kvRow("Client", escapeHtml(clientKindLabel(visit.client, visit.clientReason) || "Human")));
  rows.push(kvRow("Duration", escapeHtml(fmtDuration(visit.firstAt, visit.lastAt))));
  if (visit.mergeCount > 0) rows.push(kvRow("Merged anonymous visits", String(visit.mergeCount)));
  rows.push(kvRow("Visit id", `<code>${escapeHtml(visit.id)}</code>`));
  rows.push(kvRow("Visit key", `<code>${escapeHtml(visit.visitKey)}</code>`));
  rows.push(kvRow("Device hash", `<code>${escapeHtml(visit.hash)}</code>`));

  const meta = coerceMeta(visit.meta);
  const metaRow =
    Object.keys(meta).length > 0
      ? `<div class="meta-block"><span class="k">Meta snapshot</span><div>${renderMetaChips(meta, registry)}</div></div>`
      : "";

  return `<section class="session-info">
  <h2>Session info</h2>
  <div class="kv-col">${rows.join("")}</div>
  ${metaRow}
</section>`;
}

function renderEvents(events: Event[], registry: ReturnType<typeof asMetaKeysRegistry>): string {
  if (events.length === 0) return `<p class="muted">No events recorded.</p>`;
  const rows: string[] = [];
  // Events are newest-first; day dividers appear when the stream crosses
  // into a previous Madrid calendar day.
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

export function renderVisitDetailPage(
  visit: Visit,
  events: Event[],
  site: Site | null,
  sites: Site[],
  dayKey?: string,
  refreshHref?: string,
): string {
  const registry = asMetaKeysRegistry(site?.metaKeys);

  const body = `${renderTopbar(sites, visit.siteId, dayKey, refreshHref)}
<main class="dashboard">
  <div class="detail-tools">
    <a class="icon-btn" href="/?site=${escapeHtml(visit.siteId)}${dayQuery(dayKey)}" title="Back to visits" aria-label="Back to visits">⬅️</a>
    <a class="icon-btn icon-btn-danger" href="/visits/${escapeHtml(visit.id)}/delete?site=${escapeHtml(visit.siteId)}${dayQuery(dayKey)}" title="Delete session" aria-label="Delete session">🗑️</a>
  </div>
  ${renderSessionInfo(visit, events.length, registry)}
  <section>
    <h2>Events (${events.length})</h2>
    ${renderEvents(events, registry)}
  </section>
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

export function renderVisitDeletePage(
  visit: Visit,
  eventsCount: number,
  site: Site | null,
  sites: Site[],
  dayKey?: string,
  refreshHref?: string,
): string {
  const registry = asMetaKeysRegistry(site?.metaKeys);
  const plural = eventsCount === 1 ? "event" : "events";
  const body = `${renderTopbar(sites, visit.siteId, dayKey, refreshHref)}
<main class="dashboard">
  <p class="crumb"><a href="/visits/${escapeHtml(visit.id)}?site=${escapeHtml(visit.siteId)}${dayQuery(dayKey)}">← Back to session</a></p>
  ${renderSessionHead(visit, eventsCount, renderMetaBlock(visit, registry))}
  <section class="confirm">
    <h2>Delete this session?</h2>
    <p class="muted">The session above and its ${eventsCount} ${plural} will be permanently removed from
      ${escapeHtml(visit.siteId)}. This can't be undone.</p>
    <div class="confirm-actions">
      <a class="cancel-btn" href="/visits/${escapeHtml(visit.id)}?site=${escapeHtml(visit.siteId)}${dayQuery(dayKey)}">Cancel</a>
      <form method="post" action="/visits/${escapeHtml(visit.id)}/delete?site=${escapeHtml(visit.siteId)}${dayQuery(dayKey)}">
        <button class="delete-btn" type="submit">Delete session</button>
      </form>
    </div>
  </section>
</main>`;
  return renderLayout(`Delete ${visit.id}`, body);
}
