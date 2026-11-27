# Co Cane Cabana Purchase Spending Tracker

A lightweight, multi-business purchase spending tracker with individual PIN-based accounts, a React frontend, and a Cloudflare Workers API.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- Recharts
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- Zod

## Project layout

- `src/` — React frontend
- `worker/src/` — REST API Worker
- `worker/src/repositories/` — database access
- `worker/src/services/` — business logic
- `worker/src/schemas/` — Zod request and response schemas
- `worker/src/db/` — Drizzle database schema
- `drizzle/` — generated D1 migrations

## Prerequisites

- Node.js 22 or newer
- npm
- A Cloudflare account for remote deployments

## Local development

1. Install the pinned dependencies:

   ```powershell
   npm ci
   ```

2. Create the ignored `.dev.vars` file for local-only Worker secrets:

   ```powershell
   @'
   PIN_PEPPER=replace-with-a-random-local-secret-at-least-32-characters
   BOOTSTRAP_TOKEN=replace-with-a-random-local-registration-token
   APP_ENV=local
   '@ | Set-Content .dev.vars
   ```

3. Apply migrations to the local D1 database and start the frontend and Worker:

   ```powershell
   npm run db:migrate:local
   npm run dev
   ```

Open `http://localhost:5173`. Vite proxies `/api/*` requests to the local Worker at `http://127.0.0.1:8787`. Local D1 state is separate from both Cloudflare databases.

## D1 migrations

Generate a migration:

```powershell
npm run db:generate
```

Validate the complete migration chain against a fresh local D1 database:

```powershell
npm run db:validate
```

Apply migrations to the persistent local D1 used by `wrangler dev --local`:

```powershell
npm run db:migrate:local
```

Apply migrations to the separate remote environments:

```powershell
npm run db:migrate:staging
npm run db:migrate:production
```

Production migrations are not run by GitHub Actions. Review the migration and take a production backup first; run the production command deliberately from an authenticated Cloudflare session. Wrangler asks for confirmation in an interactive terminal. Never point either environment at the other's D1 database.

## Checks

```powershell
npm run typecheck
npm run lint
npm run build
npm run db:validate
npm run db:migrate:local
npm run test:migrations
npm run test:db
npm run test:api
npm run test:auth
npm run test:analytics
npm run test
```

## Cloudflare environments and secrets

The base Wrangler configuration is for local development. Remote deployments use two explicit environments:

| Environment | Worker | D1 database name | `APP_ENV` |
| --- | --- | --- | --- |
| Staging | `co-cane-cabana-spending-tracker-staging` | `spending-tracker-staging` | `staging` |
| Production | `co-cane-cabana-spending-tracker-production` | `spending-tracker-db` | `production` |

The D1 IDs in `wrangler.toml` are intentional placeholders. Create the databases only when ready to provision Cloudflare resources, then replace each placeholder with the ID returned by Cloudflare. Do not copy one ID into both environments:

```powershell
npx wrangler d1 create spending-tracker-staging
npx wrangler d1 create spending-tracker-db
```

The commands above are instructions only; they have not been run. Keep staging and production D1 databases, Worker secrets, and deployment API tokens separate. Staging data is for validation and is never copied automatically into production.

Worker secrets are set independently for each environment. Wrangler prompts for each value; do not put secret values in command arguments, source files, or frontend variables:

```powershell
npx wrangler secret put PIN_PEPPER --env staging
npx wrangler secret put BOOTSTRAP_TOKEN --env staging
npx wrangler secret put PIN_PEPPER --env production
npx wrangler secret put BOOTSTRAP_TOKEN --env production
```

After the first owner registers in an environment, remove that environment's bootstrap token:

```powershell
npx wrangler secret delete BOOTSTRAP_TOKEN --env staging
npx wrangler secret delete BOOTSTRAP_TOKEN --env production
```

Use different high-entropy `PIN_PEPPER` values for staging and production. Changing a pepper invalidates sessions and prevents existing PIN verification in that environment. Set `APP_ORIGIN` as a Worker variable only if required by the deployment's origin configuration; `APP_ENV` and `APP_VERSION` are already declared per environment in Wrangler.

`.dev.vars`, `.env`, and `backups/` are ignored by Git. `.env.example` contains no credentials: its Cloudflare IDs and token values are blank, and `APP_ENV` is set to the harmless local value. Remote Wrangler commands use `wrangler login` or environment-scoped CI credentials. The optional `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN` values are for Drizzle Kit's D1 HTTP driver, not a way to share credentials between environments.

## Git workflow and deployment

Use feature branches for development, open pull requests into `develop`, and promote validated releases from `develop` to `main`. The GitHub Actions workflow runs typecheck, lint, local migration validation, unit tests, API/authentication tests, database tests, and a production build on pushes and pull requests.

Configure GitHub repository **Environments** named `staging` and `production`. Add a separate, least-privilege `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable to each environment. Do not put the production token in the staging environment. Protect `develop` and `main` with pull-request and successful-check requirements. Configure required reviewers for the `production` environment so production rollout is explicitly approved. The workflow never deploys feature branches; `develop` deploys staging after checks, and `main` deploys production after checks and environment approval.

On `develop`, the workflow applies migrations to staging and deploys the Worker. It does not move staging records to production. Production migrations are deliberately manual: back up production, review and apply the production migration, then approve the production deployment. Do not merge a schema-dependent release to `main` until its production migration is ready.

The Worker serves the Vite `dist` assets and `/api/*` routes in the same deployment via Wrangler's `assets` binding. There is no separate Pages deployment.

Manual deployments from an authenticated terminal are also available:

```powershell
npm run deploy:staging
npm run deploy:production
```

For an intentional production release from a local terminal, first run checks and back up the production D1. If there are pending schema changes, apply them explicitly before deploying:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run db:backup:production
npm run db:migrate:production # only when a reviewed migration is pending
npm run deploy:production
```

## Database backup and restoration

Create `backups/` locally before exporting. Backups contain business records and must stay out of Git; `.gitignore` excludes the directory. Copy exports to an approved, access-controlled storage location and test restores periodically:

```powershell
New-Item -ItemType Directory -Force backups
npm run db:backup
npm run db:backup:staging
npm run db:backup:production
```

Restore into a **new, empty replacement D1 database**, not over the current live database. For example, create a replacement (these commands are examples and have not been run):

```powershell
npx wrangler d1 create spending-tracker-staging-restore
npx wrangler d1 create spending-tracker-production-restore
```

Update only the intended environment's `database_name` and `database_id` in `wrangler.toml` to the new database, then restore and verify it before deploying the Worker with the replacement binding:

```powershell
npm run db:restore:staging
npm run db:restore:production
```

Treat a production restore as a controlled maintenance operation: preserve the old database and its ID, restrict write traffic during the cutover, verify schema and record counts, and deploy only after validation. Never restore a production backup into staging or staging data into production.

For an application-only rollback, use Cloudflare Dashboard → **Workers & Pages** → the environment's Worker → **Deployments** to roll back to the last known-good Worker version. A Worker rollback does not reverse D1 changes. Prefer a forward-only corrective migration; restore a D1 backup to a replacement database only when necessary and follow the controlled replacement procedure above.

## CSV exports

Authenticated exports are available as:

- `/api/exports/purchases.csv`
- `/api/exports/purchase-items.csv`
- `/api/exports/categories.csv`
- `/api/exports/items.csv`

## Observability and audit history

The Worker uses Cloudflare Workers Logs (`[observability] enabled = true`) and emits structured request records plus a separate `type=product_event` record for meaningful usage events. Request records contain timestamp, level, application version, request ID, method, normalized route, status, duration, normalized browser/OS/device class, and a sanitized error code. The frontend sends an `X-Request-ID` UUID and the Worker returns the same ID in the response header. Cloudflare's automatic invocation logs are disabled to avoid storing raw request URLs.

Product events are limited to purchase create/update/delete, dashboard views, CSV exports, member joins, and login success/failure. They are logs only; they are not added to purchase audit rows or stored in D1. No Analytics Engine binding is configured: Workers Logs is sufficient for the initial low-volume metrics and avoids adding another data service.

Frontend unhandled errors, promise rejections, and React render failures report only an allow-listed error code and error type. Raw messages, stack traces, request/response data, user-agent strings, cookies, tokens, purchase names, and amounts are not sent or logged. User-agent details are normalized to a browser/OS family and major version plus device class before logging.

To inspect logs:

1. Open Cloudflare Dashboard → **Workers & Pages**.
2. Select the deployed Worker.
3. Open **Observability** and view **Logs**.
4. Filter `type` to `request` or `product_event`; filter `event` for a specific usage metric. Correlate a frontend/API issue using `requestId`.

The application pins `head_sampling_rate = 1` so the small-business event stream is complete while under Cloudflare's Free allowance. Cloudflare's [Workers Logs pricing and limits](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) currently documents a Free allowance and retention window; the documented pricing transition is December 1, 2026. Free-plan ingestion stops when its allowance is reached, so logs may be incomplete on a high-traffic day. Check the linked page and account usage before relying on long-term metrics.

Workers Logs are short-retention diagnostics, not the permanent record. Purchase business audit events are stored separately in D1 and exposed in the app's **Audit history** tab and paginated `GET /api/audit/purchases` endpoint. They include purchase ID, action, version, actor where known, and timestamp, but not item names or amounts; delete events remain after purchase deletion. Migration `0005` adds a clearly marked, unattributed baseline for purchases that existed before actor auditing, without assigning a user retroactively. There is no automatic audit purge. Back up D1 and define any future audit-retention/deletion policy against the business's legal requirements.

## Production readiness checklist

- [ ] Staging and production D1 database IDs configured and different
- [ ] GitHub `staging` and `production` environments use separate Cloudflare API tokens
- [ ] `develop` and `main` branch protections require successful checks
- [ ] Production GitHub environment requires reviewer approval
- [ ] Production D1 database ID configured
- [ ] `PIN_PEPPER` configured as a Cloudflare secret
- [ ] `BOOTSTRAP_TOKEN` configured only for initial registration, then removed
- [ ] `APP_ENV=production`
- [ ] Staging migrations applied and tested
- [ ] Production migrations reviewed and applied explicitly when required
- [ ] Owner PIN account registered
- [ ] Membership and cross-business access checks validated
- [ ] Unauthorized API requests return `401`
- [ ] Cross-business requests return `403`
- [ ] Backups tested
- [ ] Frontend build deployed
- [ ] Mobile smoke-tested
- [ ] CSV downloads tested
- [ ] Workers Logs visible and Free-plan usage monitored
- [ ] Test suite passed

## Authentication notes

Each user signs in with a unique username and an 8–12 digit PIN. PINs are salted and derived with PBKDF2-HMAC-SHA-256 in the Worker; only a keyed hash of opaque session and invitation tokens is stored. Login attempts are reserved atomically and rate-limited per username. Sessions are revocable and scoped to an active business membership. Owner members can create expiring one-time invitations and deactivate members.

PIN-only access is less resistant to guessing and account takeover than a high-entropy password or multi-factor authentication. Use unique, non-obvious PINs, keep the bootstrap token and PIN pepper private, and protect devices that remain signed in. PIN rate limiting mitigates online guessing but cannot make short PINs equivalent to passwords.

Purchase updates use optimistic version checks. Creation, update, and deletion audit events record the actor and survive purchase deletion.
