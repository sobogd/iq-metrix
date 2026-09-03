import { escapeHtml, renderLayout } from "./layout";

// Minimal login-gated placeholder — proves the auth flow works end to end.
// The real visit-list / analytics admin UI (wide-screen table, <720px
// stacked cards, same markup / CSS-only switch — see public/style.css)
// ships in a later task once the data model has been exercised for real.
export function renderHomePage(user: string): string {
  const body = `
<header class="topbar">
  <h1>📊 iq-metrix</h1>
  <form method="post" action="/logout"><button type="submit" class="link">Sign out</button></form>
</header>
<main class="placeholder">
  <p>✅ Signed in as <strong>${escapeHtml(user)}</strong>.</p>
  <p>Auth flow works end to end. The visit list and analytics admin UI ship in a later task.</p>
</main>`;
  return renderLayout("Dashboard", body);
}
