export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
