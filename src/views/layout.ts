import type { Site } from "@prisma/client";
import { madridDayKey } from "../lib/madrid";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One borderless emoji header button. Calendar / company mount a NATIVE
 *  control (real <input type="date"> / <select>) invisibly over the emoji,
 *  so clicking the emoji opens the browser's own date picker / dropdown —
 *  no custom chrome. The three one-line inline handlers on those controls
 *  (and on logout's confirm) are the app's only client JS. */
function tbButton(face: string, label: string, controlBody: string): string {
  return `
    <span class="tb-ico" title="${label}" aria-label="${label}">
      ${controlBody}
      <span class="tb-face" aria-hidden="true">${face}</span>
    </span>`;
}

/** Shared page header — left: the logo emoji + selected company's id in bold
 *  (truncating); clicking the logo or the id opens the NATIVE company select
 *  (the <select> is laid invisibly over the whole left block). Right: a row
 *  of borderless emoji buttons — refresh, calendar (native date picker),
 *  sign-out (with a native confirm). The selected Madrid day (`dayKey`) is
 *  kept when changing company or picking a date. */
export function renderTopbar(sites: Site[], currentSiteId?: string, dayKey?: string, refreshHref = "/"): string {
  const siteId = currentSiteId ?? sites[0]?.id ?? "";
  const day = (dayKey ?? madridDayKey(new Date())) as string;

  const refresh = `<a class="tb-ico" href="${escapeHtml(refreshHref)}" title="Refresh" aria-label="Refresh"><span class="tb-face" aria-hidden="true">🔄</span></a>`;

  const dayPrefix = escapeHtml(`/?site=${siteId}&day=`);
  const calendar = tbButton(
    "📅",
    "Pick a date",
    `<input type="date" class="tb-ghost" aria-label="Pick a date" value="${escapeHtml(day)}" onchange="location.href='${dayPrefix}'+encodeURIComponent(this.value)" />`,
  );

  const options = sites
    .map(
      (s) =>
        `<option value="${escapeHtml(`/?site=${s.id}&day=${day}`)}"${s.id === siteId ? " selected" : ""}>${escapeHtml(s.id)}</option>`,
    )
    .join("");

  // Logo + id block: the native company <select> sits invisibly over it, so
  // clicking the emoji or the bold id opens the picker.
  const company =
    sites.length > 0
      ? `<span class="tb-company" title="Pick a company">
  <select class="tb-ghost" aria-label="Pick a company" onchange="location.href=this.value">${options}</select>
  <span class="logo">📊</span>
  <span class="topbar-id" title="${escapeHtml(siteId)}">${escapeHtml(siteId)}</span>
</span>`
      : `<span class="logo">📊</span>`;

  const logout = `<form method="post" action="/logout" onsubmit="return confirm('Sign out?')"><button type="submit" class="tb-ico" title="Sign out" aria-label="Sign out"><span class="tb-face" aria-hidden="true">🚪</span></button></form>`;

  return `
<header class="topbar">
  <div class="topbar-inner">
    ${company}
    <div class="topbar-actions">
      ${calendar}
      ${refresh}
      ${logout}
    </div>
  </div>
</header>`;
}

/** Shared page chrome. Server-rendered template strings only — no React, no
 *  build step. The <meta name="robots"> tag here is the HTML half of
 *  anti-indexing; the X-Robots-Tag header (set globally in server.ts) is the
 *  other half. */
export function renderLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(title)} · iq-metrix</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%8A%3C/text%3E%3C/svg%3E" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
