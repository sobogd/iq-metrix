import type { Event, Site, Visit } from "@prisma/client";
import { escapeHtml, renderLayout } from "./layout";
import { asMetaKeysRegistry, coerceMeta, countryEmoji, deviceEmoji, fmtDateTime, renderMetaChips } from "./format";

// Separate page (GET /visits/:id), not a <dialog> opened from the list row.
// Picked over a dialog because this app has no client JS at all: a native
// <dialog> needs `.showModal()` (or the very new, not-yet-universal
// popover/command-invoker attributes) to open, so "no JS framework" would
// have quietly become "a few lines of vanilla JS, plus a no-JS fallback for
// when it's disabled". A plain link to a plain page needs neither — it also
// gets a real URL (bookmarkable, shareable, opens in a new tab), works with
// the browser's own back button for free, and is one <a href> away from
// every other server-rendered page in this app instead of a one-off pattern.

function topbar(): string {
  return `
<header class="topbar">
  <h1>📊 iq-metrix</h1>
  <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
</header>`;
}

export function renderVisitNotFoundPage(): string {
  const body = `${topbar()}<main class="placeholder">
    <p>⚠️ Visit not found.</p>
    <p><a href="/">← Back to visits</a></p>
  </main>`;
  return renderLayout("Not found", body);
}

function kv(label: string, value: string): string {
  return `<div class="kv"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
}

function renderEvents(events: Event[], registry: ReturnType<typeof asMetaKeysRegistry>): string {
  if (events.length === 0) return `<p class="muted">No events recorded.</p>`;
  const head = ["🕐 At", "📄 Page", "⚡ Action", "🏷️ Name", "🌐 Locale", "🧩 App", "Meta"]
    .map((h) => `<span class="viz-cell">${h}</span>`)
    .join("");
  const rows = events
    .map(
      (e) => `
    <div class="viz-row">
      <span class="viz-cell" data-label="At">${fmtDateTime(e.at)}</span>
      <span class="viz-cell" data-label="Page">${escapeHtml(e.page)}</span>
      <span class="viz-cell" data-label="Action">${escapeHtml(e.action)}</span>
      <span class="viz-cell" data-label="Name">${escapeHtml(e.name)}</span>
      <span class="viz-cell" data-label="Locale">${e.locale ? escapeHtml(e.locale) : "—"}</span>
      <span class="viz-cell" data-label="App">${e.app ? escapeHtml(e.app) : "—"}</span>
      <span class="viz-cell" data-label="Meta">${renderMetaChips(coerceMeta(e.meta), registry)}</span>
    </div>`,
    )
    .join("");
  return `<div class="viz"><div class="viz-row viz-head">${head}</div>${rows}</div>`;
}

export function renderVisitDetailPage(visit: Visit, events: Event[], site: Site | null): string {
  const registry = asMetaKeysRegistry(site?.metaKeys);
  const meta = coerceMeta(visit.meta);
  const location = `${countryEmoji(visit.country)} ${escapeHtml(visit.country)}${visit.region ? ` · ${escapeHtml(visit.region)}` : ""}${visit.city ? ` · ${escapeHtml(visit.city)}` : ""}`;

  const fields = [
    kv("Site", escapeHtml(visit.siteId)),
    kv("App", visit.app ? escapeHtml(visit.app) : "—"),
    kv("First seen", fmtDateTime(visit.firstAt)),
    kv("Last seen", fmtDateTime(visit.lastAt)),
    kv("Device", `${deviceEmoji(visit.device)} ${escapeHtml(visit.device ?? "—")}`),
    kv("OS", escapeHtml(visit.os ?? "—")),
    kv("Location", location),
    kv("Language", escapeHtml(visit.lang ?? "—")),
    kv("Theme", escapeHtml(visit.theme ?? "—")),
    kv("Identity", visit.email ? `✉️ ${escapeHtml(visit.email)}` : "👻 anon"),
    kv("From", escapeHtml(visit.from ?? "—")),
    kv("Referrer", escapeHtml(visit.ref ?? "—")),
    kv("Merged anonymous visits", String(visit.mergeCount)),
    kv("Visit id", `<code>${escapeHtml(visit.id)}</code>`),
    kv("Visit key", `<code title="${escapeHtml(visit.visitKey)}">${escapeHtml(visit.visitKey.slice(0, 16))}…</code>`),
    kv("Device hash", `<code title="${escapeHtml(visit.hash)}">${escapeHtml(visit.hash.slice(0, 16))}…</code>`),
  ].join("");

  const body = `${topbar()}
<main class="dashboard">
  <p><a href="/?site=${escapeHtml(visit.siteId)}">← Back to visits</a></p>
  <section class="card detail">
    <h2>Visit detail</h2>
    <div class="kv-grid">${fields}</div>
    <div class="meta-block">
      <span class="k">🏷️ Meta snapshot</span>
      <div>${renderMetaChips(meta, registry)}</div>
    </div>
  </section>
  <section>
    <h2>Events (${events.length})</h2>
    ${renderEvents(events, registry)}
  </section>
</main>`;
  return renderLayout(`Visit ${visit.id}`, body);
}
