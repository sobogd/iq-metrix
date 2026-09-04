import type { Site } from "@prisma/client";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared page header: logo emoji only (no title text), then the site
 *  selector (options are the site ids — iq-rest, iq-translate, …), then
 *  sign-out — all on one row, even on a phone. The selector is a native
 *  <select> whose options are self-navigating URLs; the inline onchange is
 *  the app's only client JS. */
export function renderTopbar(sites: Site[], currentSiteId?: string): string {
  const options = sites
    .map(
      (s) =>
        `<option value="/?site=${escapeHtml(s.id)}"${s.id === currentSiteId ? " selected" : ""}>${escapeHtml(s.id)}</option>`,
    )
    .join("");
  const select =
    sites.length > 0
      ? `<select class="site-select" aria-label="Domain" onchange="location.href=this.value">${options}</select>`
      : "";
  return `
<header class="topbar">
  <div class="topbar-inner">
    <a class="logo" href="/" aria-label="iq-metrix">📊</a>
    ${select}
    <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
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
