# iq-metrix

Standalone cookieless analytics backend + admin. Replaces the duplicated
analytics-v2 pipelines currently living inside the `iq-rest` monorepo
(`apps/dashboard-api/src/analytics-v2/**`) and the `translator` product
(`lib/analytics/**`), as one shared service both will eventually send data
to.

This repo is self-contained: nothing outside it points here yet. Wiring
iq-rest/translator to call `/ingest` is a separate, later task.

Stack: Node 22, TypeScript, Fastify, Prisma, Postgres. Server-rendered HTML
via plain template functions — no React/Next/build step/UI framework. One
CSS file. pm2 in production.

Intended prod: port `8205`, domain `iq-analytics.iq-rest.com`. DNS / nginx /
certbot for that domain are out of scope here and done separately — see the
comment in `src/routes/ingest.ts` about the `location /ingest { return 404;
}` block that must be added once nginx exists, since the shared-secret header
is this route's only protection until then.

## Scope of what's built so far

Data layer, `/ingest`, admin login, the visit-list/detail admin UI, and a
seed script for the two real sites. Nothing outside this repo points here
yet — wiring iq-rest/translator to actually call `/ingest` is a separate,
later task.

## Running locally

```bash
npm install
cp .env.example .env       # fill in the values below
createdb iq_metrix          # or point DATABASE_URL at any local Postgres
npx prisma migrate deploy   # applies prisma/migrations/**, hand-edited — see below
npx prisma db seed          # creates the iq-rest / iq-translate Site rows (idempotent)
npm run dev                  # tsx watch, http://localhost:8205
```

Sign in at `/login` with `ADMIN_USER`/the plaintext password behind
`ADMIN_PASSWORD_HASH`, then `/` shows the visit list (empty until something
calls `/ingest`, or you run the history import below).

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run build        # tsc -> dist/ + prisma generate
npm start             # node dist/server.js (what pm2 runs in prod)
```

## Env vars (see `.env.example`)

| Var | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `PORT` | default `8205` |
| `INGEST_SHARED_SECRET` | required `X-Ingest-Key` header value on `POST /ingest`; also used to sign the visit-continuation token (`tok`) — see `src/lib/visit-token.ts` |
| `ADMIN_USER` | admin login username |
| `ADMIN_PASSWORD_HASH` | scrypt hash, format `<salt-hex>:<derived-hex>` — generate with the one-liner below, never store a plaintext password |
| `SESSION_SECRET` | HMAC key for the `mtx_sess` admin session cookie |

Generate `ADMIN_PASSWORD_HASH`:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" 'your-password-here'
```

Generate a random secret (`INGEST_SHARED_SECRET` / `SESSION_SECRET`):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Note on the `mtx_sess` cookie: it is set with `Secure`, so it only survives
over HTTPS — except that Chromium-based browsers treat `http://localhost` as
a secure context, so login works there in local dev without any TLS setup.
Firefox does not make that exception; use Chrome/Edge for local testing, or
test the login flow after this service is actually deployed behind nginx.

## Data model

See `prisma/schema.prisma`: `Site` (one row per source product, e.g.
`iq-rest` / `iq-translate`, holding the registry of allowed `meta` keys),
`AnalyticsSalt` (daily-rotating hash salt, per site), `Visit`, `Event`.

Ported from (read, don't confuse with a dependency — nothing here imports
from either):
- `iq-rest/apps/dashboard-api/src/analytics-v2/{salt.service.ts,session-hash.ts,visit-token.ts,request-facts.ts,visit.service.ts}`
- `translator/lib/analytics/{salt.ts,session-hash.ts,visit-token.ts,request-facts.ts,visit.ts}`

Key differences from both references (see file-level comments in
`src/lib/**` for the reasoning): multi-tenant (`siteId` on every query, not
a single global salt/visit space), one `email` identity field instead of a
hardcoded `userId`/`restaurantId` split or `email`+`topicId`, a generic
`meta` Json bag for custom per-site fields, and no ad/click-id handling at
all (that feature is being removed from both source products separately).

`from` / `ref` / `theme` keep their own dedicated `Visit` columns and
first-write-wins semantics exactly like both references — only the
transport changed. The `/ingest` contract has no separate `ctx` object, so
these three are reserved keys inside the existing `meta` object instead
(visit-level and/or per-event): every site accepts them regardless of its
own `metaKeys` registry, they don't count against the per-call 8-key cap,
and they never end up stored in the `meta` Json blob — `routes/ingest.ts`
pulls them out (`meta-sanitizer.ts`'s `extractAttribution`, validated with
`FROM_REGEX`/`HOST_REGEX`/`THEME_REGEX` ported verbatim from iq-rest's
`track-v2.controller.ts`) and writes them into `Visit.from`/`ref`/`theme` via
`visit.ts`'s `applyAttribution`, guarded by an `is null` check in the update
itself so a value already set is never clobbered by a later event.

### Migration

Prisma cannot express a GIN index or an expression btree index on a Json
column. The initial migration
(`prisma/migrations/<timestamp>_init/migration.sql`) was generated with
`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma
--script` (the non-interactive equivalent of `migrate dev` — this workspace's
agent sessions have no TTY, so `migrate dev` cannot be used) and then
hand-edited to append:

```sql
CREATE INDEX "Visit_meta_gin_idx" ON "Visit" USING GIN ("meta" jsonb_path_ops);
CREATE INDEX "Visit_meta_restaurantId_idx" ON "Visit" ((("meta"->>'restaurantId')));
```

Applied and verified against a local Postgres database during development
(`npx prisma migrate deploy`, then confirmed both indexes exist via `\d
"Visit"`). Any future schema change should follow the same
diff-then-hand-edit flow rather than `migrate dev`.

## `POST /ingest`

The only write path. See the type-level contract and inline comments in
`src/routes/ingest.ts`. Auth is the `X-Ingest-Key` header (constant per
deployment, not per-request), not a session — this is a service-to-service
call from a relay that will live inside each source product (built in a
later task), never called from a browser.

## Admin UI

`GET /` (visit list) and `GET /visits/:id` (visit detail) — server-rendered
HTML, no client JS anywhere. Filters (site/app/date range/email/one free
meta key+value) go through a plain `<form method=get>`; pagination is plain
`<a href>` links. Offset pagination (`?page=N`, 30/page), not cursor —
simpler, and this list is admin-only and low-volume; a real product at scale
would want keyset pagination on `(lastAt, id)` instead. `hasNext` comes from
fetching one row past the page size rather than a separate `COUNT(*)`.

Visit detail is a separate page, not a `<dialog>` opened from the row — see
the comment at the top of `src/views/visit-detail-page.ts`. A `<dialog>`
needs at least a little client JS to open (`.showModal()`, or the very new
popover/command-invoker attributes); a plain link needs none, and gets a
real bookmarkable/shareable URL and the browser's own back button for free.

Meta chips (on both pages) are rendered generically from the current site's
`Site.metaKeys` registry — nothing in the view code hardcodes `restaurantId`
or `topicId`. A key with a `{v}` link template renders as an external
`target=_blank` link to the source product's own admin; anything else
renders as plain text.

The one free meta filter accepts either `?meta.<key>=<value>` directly in
the URL (canonical, what pagination links emit) or the filter form's own
`metaKey`+`metaValue` pair (a plain `<select>`+`<input>` can't rename its
`name` to a dynamic `meta.<key>` without JS) — `src/routes/home.ts` accepts
both. It filters on `Visit.meta` via the hand-added expression index
(confirmed with `EXPLAIN` during development — see below), which only ever
gets populated by a real `/ingest` call (`applyIngestSnapshot`); imported
history (below) leaves `Visit.meta` empty by design, so this filter will not
find restaurantId/topicId on historical visits, only on visits an actual
`/ingest` call has touched since. Per-event `meta` (shown on the detail
page) does not have this gap — the import script sets it directly.

The 4 charts (visits/day last 30d, top countries, device breakdown, top
pages) are inline `<svg>` bar charts computed from `GROUP BY` aggregates in
`src/lib/visit-queries.ts`, rendered by `src/lib/svg-chart.ts` — no chart
library. Each is a single-series magnitude comparison (one measure, ranked
or over time), so one consistent accent hue with no legend is correct per
the dataviz color-by-job rule; a multi-series chart would need the
categorical palette instead. Every bar carries a native SVG `<title>` for a
zero-JS hover tooltip.

## Deploy

`.github/workflows/deploy.yml` mirrors this workspace's push-to-`release`
pattern (see `translator`/`money`). It has never run — nothing has been
pushed. `ecosystem.config.js` is the pm2 process definition used on the
server (fork mode, single instance — the salt cache and rate limiter are
in-process state, so this must stay one process unless that's moved to a
shared store).
