import { escapeHtml, renderLayout } from "./layout";

export function renderLoginPage(error?: string): string {
  const body = `
<main class="auth">
  <form class="card" method="post" action="/login">
    <h1>📊 iq-metrix</h1>
    <p class="sub">Sign in to continue</p>
    ${error ? `<p class="error">⚠️ ${escapeHtml(error)}</p>` : ""}
    <label for="user">Username</label>
    <input id="user" name="user" type="text" autocomplete="username" required autofocus />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
</main>`;
  return renderLayout("Sign in", body);
}
