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

/** Shared page header — left: the logo emoji (not interactive), the selected
 *  company's id in bold (truncating), then the 🏢 company icon (a native
 *  <select> laid invisibly over it) and the 📅 date control showing the day
 *  as short text ("7.10.24", native <input type="date"> over it) — the
 *  emojis separate the fields, no dot. Right: borderless emoji buttons —
 *  refresh, sign-out (with a native confirm). The day is never duplicated in
 *  the page body — the header owns it. */
export function renderTopbar(sites: Site[], currentSiteId?: string, dayKey?: string, refreshHref = "/"): string {
  const siteId = currentSiteId ?? sites[0]?.id ?? "";
  const day = (dayKey ?? madridDayKey(new Date())) as string;
  const dayPrefix = escapeHtml(`/?site=${siteId}&day=`);

  const refresh = `<a class="tb-ico" href="${escapeHtml(refreshHref)}" title="Refresh" aria-label="Refresh"><span class="tb-face" aria-hidden="true">🔄</span></a>`;
  const logout = `<form method="post" action="/logout" onsubmit="return confirm('Sign out?')"><button type="submit" class="tb-ico" title="Sign out" aria-label="Sign out"><span class="tb-face" aria-hidden="true">🚪</span></button></form>`;

  if (sites.length === 0) {
    return `
<header class="topbar">
  <div class="topbar-inner">
    <div class="topbar-actions">
      ${refresh}
      ${logout}
    </div>
  </div>
</header>`;
  }

  const options = sites
    .map(
      (s) =>
        `<option value="${escapeHtml(`/?site=${s.id}&day=${day}`)}"${s.id === siteId ? " selected" : ""}>${escapeHtml(s.id)}</option>`,
    )
    .join("");

  // Short day text, "7.10.24" (no padding).
  const [y, m, d] = day.split("-").map(Number);
  const shortDate = `${d}.${m}.${String(y).slice(2)}`;

  const companyIcon = `<span class="tb-ico" title="Pick a company" aria-label="Pick a company">
  <select class="tb-ghost" aria-label="Pick a company" onchange="location.href=this.value">${options}</select>
  <span class="tb-face" aria-hidden="true">🏢</span>
</span>`;

  const dateControl = `<span class="tb-date" title="Pick a date">
  <input type="date" class="tb-ghost" aria-label="Pick a date" value="${escapeHtml(day)}" onchange="location.href='${dayPrefix}'+encodeURIComponent(this.value)" />
  <span class="tb-face" aria-hidden="true">📅</span>
  <span class="tb-day">${escapeHtml(shortDate)}</span>
</span>`;

  return `
<header class="topbar">
  <div class="topbar-inner">
    <span class="topbar-id" title="${escapeHtml(siteId)}">${escapeHtml(siteId)}</span>
    ${companyIcon}
    ${dateControl}
    <div class="topbar-actions">
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
