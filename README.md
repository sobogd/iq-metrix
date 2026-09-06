# iq-metrix

Standalone cookieless analytics backend + admin for the IQ Rest products. One
shared service that the landing, the dashboard, translator and iq-mermaid all
send events to — replacing the duplicated `analytics-v2` pipelines that used to
live inside `iq-rest` (`apps/dashboard-api/src/analytics-v2/**`) and
`translator` (`lib/analytics/**`).

**Status: live in production.** The service is deployed behind nginx, all four
domains resolve, and the consumers below are already wired to it. Admin UI:
<https://iq-metrix.iq-rest.com>.

## Stack

Node 22, TypeScript, Fastify, Prisma, PostgreSQL. Server-rendered HTML via plain
template functions — no React/Next/build step/UI framework, and no client JS
except one inline `onchange` on the header's domain dropdown.
One CSS file (`public/style.css`). pm2 in production (fork mode, **single
instance** — the salt cache/rotation lock and the rate limiter are in-process
state).

## Repo layout

```
src/
  routes/        ingest.ts, public-e.ts, login.ts, home.ts, visit-detail.ts, robots.ts
  lib/           salt.ts, session-hash.ts, visit.ts, visit-token.ts,
                 request-facts.ts, meta-sanitizer.ts, visit-queries.ts, …
  views/         server-rendered HTML templates (layout, login, visit list/detail)
  server.ts, env.ts, db.ts
prisma/          schema.prisma, migrations/, seed.ts
public/style.css
scripts/import-history.ts        one-time history backfill (not part of the app)
ecosystem.config.js              pm2 process definition
.github/workflows/deploy.yml     push-to-main deploy
```

## Data model (`prisma/schema.prisma`)

| Model | Purpose |
| --- | --- |
| `Site` | One row per source product (`iq-rest`, `iq-translate`, `iq-mermaid`). Holds `domain` and the registry of allowed `meta` keys (`metaKeys`). |
| `AnalyticsSalt` | Singleton-per-site (`id = "current"`) holding the active hash salt. Rotated daily at 04:00 Europe/Madrid. |
| `Visit` | One row = one **visit**: a device hash plus an identity, cut after 30 minutes of silence. Multi-tenant (`siteId`). |
| `Event` | Minimal event rows (page/action/name triple + optional concrete `path`, plus a `seen` flag backing the list's green "new" dot); device/geo/source live on the visit. |

Key design decisions (vs. the two reference pipelines this was ported from):

- **Multi-tenant** — every query is scoped by `siteId`; each site has its own
  salt row. There is no single global salt/visit space.
- **One identity field** — a single `email`, instead of iq-rest's
  `userId`/`restaurantId` split or translator's `email` + `topicId`.
- **Generic `meta` Json bag** for custom per-site fields (restaurantId, topicId,
  plan, …), validated against the site's `metaKeys` registry.
- **`from` / `ref` / `theme`** keep their own dedicated `Visit` columns with
  first-write-wins semantics, exactly like the references. They are the only
  three reserved keys that bypass the `metaKeys` allowlist and never land in the
  stored `meta` blob (they are pulled out and written to the dedicated columns).
- **No ad/click-id handling** — `FBCLID`/`GCLID` capture was not ported (that
  feature is removed from both source products). Click-id fields a client still
  sends are simply ignored.
- **Client classification** — the visit's UA is classified at ingest into
  `human` / `search` / `ai` / `preview` / `bot` (`Visit.client` + a
  `clientReason` token explaining the verdict; the raw UA is never
  stored). Search-engine labels are DNS-verified when possible, and a
  nightly pass catches anonymous burst crawlers — see the dedicated bullet
  further down. Only server-side scripts (curl/axios/headless) are dropped.

## Endpoints

### `POST /ingest` — service-to-service

The relay path. Auth is the `X-Ingest-Key` header (a constant shared secret per
deployment), not a session — this is a server-to-server call from a relay inside
a source product, never a browser. Body: `site`, `ip`, `ua`, optional
`headers`/`email`/`app`/`meta`/`tok`, and an `events` array (≤ 50, each a
`page`/`action`/`name` triple with optional `path`/`locale`/`meta`/`at`). `path`
is the concrete pathname of the page the event happened on (`/`, `/ru`,
`/ru/feature-slug`) — the coarse `page` label stays the type, `path` is the real
URL; browser clients have stamped it since Sep 2026, server-fired events may
omit it. Returns
`{ tok }` — a fresh visit-continuation token.

Attribution (`from`/`ref`/`theme`) arrives as **reserved keys inside `meta`**
(visit-level and/or per-event) — there is no separate `ctx` object on this
contract.

### `POST /e` (+ `OPTIONS /e`) — browser

Public browser-facing ingest, posting **directly** from the visitor's page rather
than through a relay. CORS is resolved against a fixed `ORIGIN_TABLE` (origin →
site/app), never a client-supplied field — an unknown or missing `Origin` is
rejected with 403, and the reflected `Access-Control-Allow-Origin` always comes
from that table (no wildcard, since `Access-Control-Allow-Credentials` forbids
one anyway).

Identity is attribution-only: for the iq-rest origins the UI-readable `iqr_email`
cookie (set on the `.iq-rest.com` apex) rides along and is read for attribution;
a forged cookie can only mis-attribute the forger's own traffic. translator and
mermaid are different eTLD+1s (or have no accounts), so their events land
anonymous by construction.

Wire format is each caller's existing client **unchanged** — only the target
origin moved. Two details are load-bearing: the opaque `/e` path (readable
"track"-style paths are on ad-blocker lists) and a `text/plain` body (keeps the
POST CORS-*simple*, so no preflight, and it is the only type `sendBeacon` can
carry). Attribution arrives via a `ctx` object here (the browser clients'
existing shape) as well as per-event `meta`. Returns `{ v: tok }` — matching the
old dashboard-api `/api/e` response shape the clients were already built
against, so the clients needed zero changes beyond their target URL.

### Admin

- `GET /login`, `POST /login` (rate-limited 5/min), `POST /logout` — one admin
  account, scrypt password hash, HMAC-signed `mtx_sess` cookie.
- `GET /` — visit list.
- `GET /visits/:id` — visit detail.
- `GET /visits/:id/delete` — delete-confirm page (re-renders the session head,
  changes nothing).
- `POST /visits/:id/delete` — the only destructive step: permanently deletes
  the session (events go via the FK cascade) and redirects to the site list.
  State changes are form posts only, so no bare link can ever delete.
- `GET /robots.txt`, `GET /style.css`.

## Cookieless mechanics

The core of the service, ported from the two references and made multi-tenant:

- **Daily salt rotation** (`lib/salt.ts`) — `sessionHash` is
  `sha256(salt | network | ua | entropy)`; the salt rotates at 04:00 Madrid and
  the previous one is destroyed by the overwrite, which is what makes hashes
  unlinkable across salt-days. Rotation is lazy-on-read, cached in-process.
- **Network coarsening** (`lib/request-facts.ts`) — the hash uses the network,
  not the exact IP: IPv4 keeps the /24, IPv6 the /64 (so a phone's rotating
  IPv6 low bits don't split one visitor into many visits). Extra entropy from
  the full Accept-Language header + geo splits people sharing an ip+ua behind a
  NAT. The raw IP lives only on the stack frame — never persisted or logged.
- **Visit dedup** (`lib/session-hash.ts`) — `visitKey = sha256(hash | email |
  start-minute)`; the start-minute bucket makes racing "start a visit" requests
  converge on one row.
- **Visit lifecycle** (`lib/visit.ts`) — resolve/continue/fold/promote: an
  anonymous row is promoted in place when an email resolves (pre-identification
  events stay on the row), and a stray anonymous row is folded into the
  signed-in one. Idle window is 30 minutes.
- **Continuation token** (`lib/visit-token.ts`) — the ingest response hands back
  an HMAC-signed `<visitId>.<iat>.<hmac>`; echoing it pins later batches to the
  same visit when the device hash flaps mid-visit (mobile network prefix / geo
  changing between requests). Clients keep it only in page memory, never in any
  storage.
- **Attribution** — `from`/`ref`/`theme` are first-write-wins, enforced by
  race-safe `WHERE <field> IS NULL` updates; the `app`/`meta` snapshot is
  deliberately latest-wins.
- **Meta sanitizer** (`lib/meta-sanitizer.ts`) — only keys registered in the
  site's `metaKeys` are kept, capped at 8 keys / 32-char key / 128-char value; a
  bad key is dropped, not fatal. `from`/`ref`/`theme` are reserved across every
  site.
- **Client classification** (`lib/client-kind.ts`) — the UA is classified at
  ingest into `human` / `search` / `ai` / `preview` / `bot`; only server-side
  scripts (curl/axios/headless) are dropped, everything else is stored so
  crawler and AI-agent traffic can be measured. Classification is
  deliberate:
  - crawler tokens are matched **anchored** (as product tokens, never as a
    bare substring — substring matching mislabels non-engine tools as
    "search");
  - the search-engine label is **proven**, not guessed, for Google/Bing/
    Yandex/DuckDuckGo: engine-looking UAs from public IPs are verified with
    reverse + forward DNS against the engine's published hostnames (cached
    per IP, 24h), and a UA that claims an engine but fails DNS is stored as
    a spoofed bot;
  - a nightly pass (`lib/reclassify.ts`, 05:30 Europe/Madrid, plus once a
    minute after boot) reclassifies anonymous "burst" crawler visits (6+
    pageview events inside ≤3 s, no email) as bots — the one pattern UA
    analysis can never see;
  - `Visit.clientReason` records *why* a label was chosen
    (`token:gptbot`, `dns:googlebot.com`, `isbot`, `no-browser-markers`,
    `behaviour:burst`, …), so every verdict is answerable from data. The
    raw UA is never stored.

## Admin UI

Server-rendered HTML, mobile-first. A sticky topbar holds everything on one
row even on a phone: the **selected company's id in bold** (truncating),
then the 🏢 company icon (a native `<select>` of the site ids — iq-rest /
iq-translate / iq-mermaid — laid invisibly over it) and the 📅 date control
showing the selected day as short text (`7.10.24`, with a real native
`<input type="date">` over it, so clicking opens the browser's own date
picker), and on the right two **borderless emoji buttons** — refresh (🔄, a
link to the current request URL) and sign-out (🚪, a POST confirmed by the
browser's native `confirm()`). Those one-line inline handlers are the app's
only client JS.

The dashboard is deliberately chart-free, filter-free and ranking-free —
one **Madrid calendar day per page**, picked with the 📅 control in the
header (`?day=YYYY-MM-DD`, default today), shown there as `7.10.24` and never
duplicated in the page body. Under
that day,
the numeric summary strip counts **visits** (sessions with any activity
inside the day — the window overlaps it, so a session that fired on both
sides of midnight appears on both days' lists), **events** (`at` inside the
day) and **distinct identified emails** — all over 00:00–23:59 Europe/Madrid
(the same clock the salt rotation is anchored to). There is no live number
in the strip — liveness is per-row (see below). The cards
sit in one row even on a phone. Everything is computed in `src/lib/visit-queries.ts` with the day bounds
from `src/lib/madrid.ts`; every timestamp in the
admin (list rows, detail page, events table) renders on a Europe/Madrid
clock regardless of the server's own timezone (`src/views/format.ts`).

The visit list is the raw drill-down for that day — **every** session that
was active during it, newest-active first, **no pagination** (the list IS the
day). One compact row per session, rendered as **plain text — no chips/pills
anywhere**; every value simply keeps the *color* its chip used to carry, and
all text renders at 14px:
the first line is a head row — the geography on the left (country flag
emoji, country name, then, when there is a region or a city, a 📍 marker
followed by the region and a comma-separated city: `🇪🇸 Spain 📍 California,
San Francisco`; no commas dangle when either part is missing); on the right,
for non-human traffic, the **client** as one combined field in muted text
(`Search engine · Google`, `Search engine · Google (IP verified)`, `AI
crawler · OpenAI GPTBot`, `Bot · no browser markers`, `Link preview · X
(Twitter)`, …), and a green 🟢 "new" dot when the session has events the
admin has not seen yet (on narrow screens the client drops to its own line
under the geography); the second line is the
**entry address** — where the session opened, as the concrete pathname in the
page/path purple (`/`, `/ru/feature-slug`) — it appears only when the visit
recorded a pathname, so sessions ingested before path capture get no address
line at all; the third line is dot-separated (`·`) colored text — the theme
as an emoji (🌙 dark / ☀️ light) right before the last-activity time as
`HH:MM` only (the selected day lives in the header, so no date is shown),
then the event count as the bare number, the source (`via <referrer>` or
`from <campaign>`, green), OS (Windows/macOS/iOS/Android — the device form
factor is implied), `Tablet` only when the visit really came from a tablet,
and language, each in its chip color; the fourth line appears only for
identified sessions and carries the email in its green — anonymous rows get
no identity line at all. No app/landing label is shown, no duration value
(the window length still lives on the detail page).
The green dot is the "new/unseen" signal, backed by `Event.seen`: events
start unseen at ingest; the moment the sessions list (or the visit detail)
returns a session it marks that session's events as seen, so a session shows
its 🟢 on the first load after its events arrived and loses it from the next
load — until genuinely new events land. All
traffic is still stored and listed — human, search-engine, AI-agent
and other-bot visits alike — with no lens to hide any of it. The whole
row links to the visit detail, carrying the selected day along
(`/visits/:id?site=…&day=…`) so "← Back to visits" (and the delete flow)
returns to the same day.

Visit detail is a separate page (not a `<dialog>` — that would need client JS).
Its top tools row holds two icon buttons: ⬅️ back to the visits list (keeping
the selected day) and, on the right, 🗑️ delete. Everything known about the
session sits in an always-visible **Session info** block — one field per
row (country/region/city, first/last seen, events, app, OS, language, theme,
referrer/from, email, client as the combined kind+reason line, duration,
merge count, ids/hashes, meta snapshot) — so the page reads: tools, the
block, then the event list as the main content. Below it, every event
is a card in exactly the sessions-list layout
(flat text at 14px, chip colors only, no pills), **newest first**: the head
line carries the event name with the action verb in its funnel color, the
page pathname (`/`, `/ru/feature-slug`) sits under it in purple when the
event recorded one, and a dot-separated meta line holds HH:MM:SS · locale ·
app · the per-event meta values (keys with a `{v}` link template stay links
to the source product's own admin). The 🗑️ link GETs to a JS-free confirm
page (the same session head re-rendered, so you see exactly what goes); only
the confirm page's POST actually deletes the visit and its events and
redirects back to the site's session list.

## Who sends data here

| Product | Path | Identity |
| --- | --- | --- |
| iq-rest landing | `POST https://e.iq-rest.com/e` (browser, direct) | `iqr_email` cookie (same-site) |
| iq-rest dashboard-web | `POST https://e.iq-rest.com/e` (browser, direct) | `iqr_email` cookie (same-site) |
| translator | `POST https://e.iq-translate.com/e` (browser, direct) | anonymous (cross-site; cookie can't ride along) |
| translator — server-fired sign-in/register | `POST http://127.0.0.1:8205/ingest` (relay) | email resolved server-side |
| iq-mermaid | `POST https://e.iq-mermaid.com/e` (browser, direct) | anonymous (no accounts) |

The browser clients live in the consumer repos, not here:
`iq-rest/apps/landing/lib/analytics.ts`, `iq-rest/apps/dashboard-web/src/lib/analytics.ts`,
`translator/lib/analytics.ts`, `mermaid/lib/analytics.ts`. translator's relay is
`translator/lib/analytics/ingest.ts` (forward-with-timeout + on-disk spool, so a
transient outage never loses an event). dashboard-api's own analytics-v2 relay
was removed — its `src/analytics-v2` directory is empty; the iq-rest browser apps
now hit `/e` directly. The landing / translator / mermaid clients stamp each
event with the page's pathname (`path`) as of the Sep 2026 path-capture change;
the dashboard-web client predates it and sends none (its events all report the
single `Dashboard` page anyway).

## Production / infra

- Port **8205**. Admin domain **`iq-metrix.iq-rest.com`**.
- DNS (all four → `46.225.143.221`, the shared prod box):
  `iq-metrix.iq-rest.com`, `e.iq-rest.com`, `e.iq-translate.com`, `e.iq-mermaid.com`.
- **nginx 1.18** (Ubuntu) fronts the service with a Let's Encrypt cert.
- **`/ingest` is blocked at nginx** (public `POST /ingest` → nginx 404), so it
  is reachable only on `127.0.0.1:8205` where the relays call it; the
  `X-Ingest-Key` shared secret is the localhost-path defense.
- The `e.*` vhosts expose **only `/e`** — the admin UI is not reachable there
  (`e.iq-rest.com/login` → 404). The admin UI lives on `iq-metrix.iq-rest.com`
  only.
- **Deploy** — `.github/workflows/deploy.yml` runs on every push to `main`
  (the only branch; the old `release` branch was removed): Node 22, `npm ci` →
  typecheck → build → scp `dist/` + `prisma/` + `public/` +
  `ecosystem.config.js` to the server → write `.env` from GH secrets →
  `prisma migrate deploy` + `prisma generate` → `pm2 restart iq-metrix`
  (or `pm2 start ecosystem.config.js`).

## Running locally

```bash
npm install
cp .env.example .env       # fill in the values (see Env vars)
createdb iq_metrix          # or point DATABASE_URL at any local Postgres
npx prisma migrate deploy   # applies prisma/migrations/**
npx prisma db seed          # creates the iq-rest / iq-translate / iq-mermaid Site rows (idempotent)
npm run dev                 # tsx watch, http://localhost:8205
```

Sign in at `/login` with `ADMIN_USER` / the plaintext password behind
`ADMIN_PASSWORD_HASH`; `/` then shows the visit list (empty until something calls
`/e` or `/ingest`, or you run the history import).

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build        # tsc -> dist/ + prisma generate
npm start             # node --env-file=.env dist/server.js (what pm2 runs in prod)
```

> The `mtx_sess` cookie is set with `Secure`. Chromium treats
> `http://localhost` as a secure context, so login works there in local dev
> without TLS; Firefox does not make that exception — use Chrome/Edge locally, or
> test login against the deployed service.

## Env vars (see `.env.example`)

| Var | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `PORT` | default `8205` |
| `INGEST_SHARED_SECRET` | required `X-Ingest-Key` value on `POST /ingest`; also signs the visit-continuation token (`src/lib/visit-token.ts`) |
| `ADMIN_USER` | admin login username |
| `ADMIN_PASSWORD_HASH` | scrypt hash, format `<salt-hex>:<derived-hex>` (never store a plaintext password) |
| `SESSION_SECRET` | HMAC key for the `mtx_sess` admin session cookie |

Generate the password hash:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password-here'
```

Generate a random secret (`INGEST_SHARED_SECRET` / `SESSION_SECRET`):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## History import

`scripts/import-history.ts` — one-time backfill from iq-rest's/translator's own
`sessions_new`/`events_new` tables into this service's `Visit`/`Event`.
Standalone (run via `npx tsx scripts/import-history.ts --site=iq-rest` or
`--site=iq-translate`), not part of the server and not wired into any npm script
or CI. mermaid has no old analytics tables, so there is nothing to import for it.

Reads the source DB with a plain `pg` client and raw SQL (deliberately does not
depend on either product's own Prisma client/schema). Idempotent — it reuses the
source row's own `id`/`visitKey`, so a rerun's `createMany({ skipDuplicates:
true })` no-ops on rows already imported. Source DB defaults to each product's
local dev database; override with `SOURCE_DATABASE_URL` for a prod cutover run.

## Migration note

Prisma cannot express a GIN index or an expression btree index on a Json column,
so the initial migration (`prisma/migrations/**/migration.sql`) was generated
with `prisma migrate diff` and then hand-edited to append:

```sql
CREATE INDEX "Visit_meta_gin_idx" ON "Visit" USING GIN ("meta" jsonb_path_ops);
CREATE INDEX "Visit_meta_restaurantId_idx" ON "Visit" ((("meta"->>'restaurantId')));
```

Any future schema change should follow the same diff-then-hand-edit flow rather
than `migrate dev` (this workspace's agent sessions have no TTY).
