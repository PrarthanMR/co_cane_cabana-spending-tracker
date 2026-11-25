# Co Cane Cabana Purchase Spending Tracker

A lightweight React and Cloudflare Workers application for understanding purchase spending. This repository is initialized with only the application shell and infrastructure; business features are intentionally not implemented.

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

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the environment template if you plan to use remote D1 operations:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Start the frontend and local Worker together:

   ```powershell
   npm run dev
   ```

4. Open `http://localhost:5173`. The frontend proxies `/api/*` requests to the local Worker at `http://127.0.0.1:8787`.

## D1 migrations

Generate a migration:

```powershell
npm run db:generate
```

Apply migrations locally:

```powershell
npm run db:migrate
```

Apply migrations remotely:

```powershell
npm run db:migrate:remote
```

Remote migration commands require the Cloudflare environment variables in `.env.example`.

## Checks

```powershell
npm run typecheck
npm run lint
npm run build
npm run db:migrate
npm run test:db
npm run test:api
npm run test:analytics
npm run test
```

## Environment variables

Set these in Cloudflare Worker environment secrets, never in frontend source:

- `OWNER_ACCESS_TOKEN`: long random bearer token for the sole owner.
- `OWNER_BUSINESS_ID`: business ID owned by the authenticated operator.
- `APP_ENV`: use `production` for deployed environments.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_D1_TOKEN`: only for remote Drizzle or migration tooling.

Local development uses `.dev.vars`, which is ignored by Git. Create it from `.env.example` and replace both owner values before local use.

Set production secrets:

```powershell
npx wrangler secret put OWNER_ACCESS_TOKEN --env production
npx wrangler secret put OWNER_BUSINESS_ID --env production
```

## Production D1 and deployment

1. Create the production database:

   ```powershell
   npx wrangler d1 create spending-tracker-db
   ```

2. Replace `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID` in `wrangler.toml` with the returned database ID.

3. Apply migrations:

   ```powershell
   npm run db:migrate:remote
   ```

4. Build and deploy:

   ```powershell
   npm run deploy
   ```

The Worker is configured to serve the Vite `dist` assets and protect `/api/*` routes with owner authentication.

## Database backup and restoration

Create backups:

```powershell
npm run db:backup
npm run db:backup:remote
```

Restore local or remote SQL:

```powershell
npm run db:restore
npm run db:restore:remote
```

Restore only during a maintenance window and verify row counts after restoring.

## CSV exports

Authenticated owner exports are available as:

- `/api/exports/purchases.csv`
- `/api/exports/purchase-items.csv`
- `/api/exports/categories.csv`
- `/api/exports/items.csv`

## Production readiness checklist

- [ ] Production D1 database ID configured
- [ ] `OWNER_ACCESS_TOKEN` configured as a Cloudflare secret
- [ ] `OWNER_BUSINESS_ID` configured
- [ ] `APP_ENV=production`
- [ ] Remote migrations applied
- [ ] Owner access validated
- [ ] Unauthorized API requests return `401`
- [ ] Cross-business requests return `403`
- [ ] Backups tested
- [ ] Frontend build deployed
- [ ] Mobile smoke-tested
- [ ] CSV downloads tested
- [ ] Test suite passed
