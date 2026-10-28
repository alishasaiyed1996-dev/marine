# Deploying Alka Traders to Railway

Two services in one Railway project:

```
alka-traders/                     # Railway project
├── marine (frontend)             # Express server.js + Vite-built storefront
└── api   (backend)              # Express API + Prisma + PostgreSQL
```

---

## 1. Create the Railway project

1. Push this repo to GitHub if you haven't already.
2. In Railway, click **New Project → Deploy from GitHub repo** and select this repo.
3. Railway will auto-detect services. If it doesn't, create two services manually:

### Service 1 — `marine` (frontend)

- **Source directory:** `/` (repository root)
- **Build command:** `npm run build`
- **Start command:** `node server.js`
- **Node version:** 22 (set `NODE_VERSION=22` in service vars, or add `.nvmrc`)
- **HTTP port:** `3000` ( Railway auto-detects from `PORT` — `server.js` reads `process.env.PORT || 3000`)

The root `package.json` `build` script runs the full pipeline:
```bash
npm run build:backend && node ./node_modules/typescript/bin/tsc -b && \
node ./node_modules/vite/bin/vite.js build && \
node scripts/prerender.mjs --dist frontend/dist && \
node scripts/copy-frontend.mjs
```
That means **one build command at the root builds both backend and frontend**. The `marine` service uses the built frontend and the Express routes in `server.js`; `/sitemap.xml` is a runtime API proxy, not a build-generated static file.

If you want the `marine` service to build only the frontend (faster, fewer deps), set its build command to:
```bash
npm run build:frontend
```
and its start command to `npm start` (runs `node server.js`).

### Service 2 — `api` (backend)

- **Source directory:** `/backend`
- **Build command:** `npm run build`
- **Start command:** `npm run start`  (runs `node dist/server.js`)
- **Node version:** 22
- **HTTP port:** `3001` (set `PORT=3001` in vars, or the backend defaults to 3001)

The backend `build` script runs `prisma generate && tsc`, and `postinstall` runs `prisma generate || exit 0` so the Prisma client is generated even if you change the build command.

---

## 2. Provision PostgreSQL on Railway

1. In your Railway project, click **New → Database → PostgreSQL**.
2. Name it `db` (or whatever you like).
3. Once created, go to the **Variables** tab and copy the connection string — it's a `postgresql://...` URL.
4. On the **`api` service**, add these variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Railway PostgreSQL URL |
| `DIRECT_URL` | the same Railway PostgreSQL URL |

> On Railway there is no separate pooler vs direct endpoint like Neon, so both `DATABASE_URL` and `DIRECT_URL` get the same value.

5. On the **`api` service**, add the rest of the env vars from `backend/.env.example` (see the table below).

---

## 3. Environment variables

### `api` service (backend) — required

These are **required** for the server to start in production. `env.ts` refuses to boot if `JWT_SECRET` or `DATABASE_URL` are missing.

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` (or leave unset — Railway sets it) |
| `DATABASE_URL` | Railway PostgreSQL connection string |
| `DIRECT_URL` | Same as `DATABASE_URL` |
| `JWT_SECRET` | Random 64+ char string — **do not reuse the dev fallback** |
| `CSRF_SECRET` | Random 64+ char string — falls back to `JWT_SECRET` if unset |
| `FRONTEND_URL` | Your frontend URL (e.g. `https://alkatraders.co` or the `web` service's `*.railway.app` URL) |
| `CORS_ORIGIN` | Comma-separated origins allowed to call the API with credentials. Include your frontend domain. Example: `https://alkatraders.co` (non-www apex — `www` is not attached to Railway) |
| `ADMIN_URL` | Admin panel base URL (used in some email links). Example: `https://alkatraders.co/admin` |

### `api` service — email

Resend (HTTPS API) is the only email transport. Railway blocks outbound SMTP
ports (25/465/587/2525), so the nodemailer/SMTP fallback was removed on
2026-10-28 — no `SMTP_*` variables exist anywhere anymore.

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | **Required** for delivery. Without it emails are queued as `skipped` and never sent |
| `EMAIL_FROM` | From address for all outbound emails — its domain must be verified in the Resend dashboard (SPF/DKIM) |
| `SALES_EMAIL` | Default inbound routing for RFQ / emergency / contact form submissions |

Verify delivery: `npx tsx scripts/diag-email-queue.ts --send-test` (real send via
Resend + inbox check) and `--domains` (sending-domain verification status).

### `api` service — payments

| Variable | Notes |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal client secret |
| `PAYPAL_MODE` | `sandbox` or `live` |
| `PAYPAL_WEBHOOK_ID` | Required to verify webhook signatures in production |

### `api` service — Cloudinary

| Variable | Notes |
|---|---|
| `CLOUDINARY_URL` | Cloudinary URL (`cloudinary://api_key:api_secret@cloud_name`) |

### `api` service — monitoring

| Variable | Notes |
|---|---|
| `SENTRY_DSN` | Sentry DSN (optional) |
| `LOG_LEVEL` | `info` recommended in production |

### `api` service — seed (only needed for first deploy / fresh DB)

| Variable | Notes |
|---|---|
| `ADMIN_EMAIL` | Admin user email (default `admin@alkatraders.co`) |
| `ADMIN_NAME` | Admin display name (default `Store Owner`) |
| `ADMIN_PASSWORD` | **Required** for seeding — set a strong password |

### `web` service (frontend) — required

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `VITE_API_URL` | The `api` service URL — your `*.railway.app` backend URL, or your custom domain once DNS is pointed. Example: `https://api-xxx.railway.app` |
| `VITE_DEFAULT_THEME` | `light` or `dark` (default `light`) |

> **Important:** Do not put backend secrets (`JWT_SECRET`, `DATABASE_URL`, PayPal, Cloudinary, SMTP, etc.) in the `web` service. Vite inlines every `VITE_*` variable into the frontend JavaScript bundle at build time. Only public, non-secret config goes here.

---

## 4. First deploy — database setup

After the first deploy, the `api` service will start but the database tables won't exist yet. You have two options:

### Option A — Fresh start (seed only)

If you don't need to move existing data from Neon:

1. On the `api` service in Railway, open the **Deployments** tab and open the **Shell** for the latest deployment (or run locally pointing at the Railway DB).
2. Run:
   ```bash
   npx prisma migrate deploy
   npx tsx prisma/seed.ts
   ```
3. The seed creates the admin user, categories, brands, industries, and store settings.

### Option B — Move existing Neon data to Railway

If you have production data on Neon you want to keep:

```bash
# 1. Export from Neon
pg_dump -h ep-xxx-pooler.us-east-1.aws.neon.tech \
  -U neondb_owner \
  -d neondb \
  -f alka-traders.dump

# 2. Import to Railway PostgreSQL
pg_restore -h host.railway.app \
  -p 5432 \
  -U postgres \
  -d dbname \
  -W \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  alka-traders.dump
```

Then run `npx prisma migrate deploy` on the Railway DB to make sure the schema matches (your migrations are already applied on Neon; Railway Postgres should be at the same schema version after the restore, but running `migrate deploy` is harmless and ensures the migration history table is in sync).

> **Note:** `pg_dump`/`pg_restore` require the PostgreSQL CLI. If you don't have it locally, you can run the restore from a Railway service shell or a temporary compute. Alternatively, use a GUI like pgAdmin or TablePlus to export/import.

### After data migration

1. Run `npx prisma generate` and redeploy the `api` service so the generated client matches.
2. Verify `/api/health` returns `{"status":"ok","database":"connected"}`.
3. Log in to `/admin` with the admin credentials you configured.

---

## 5. Health checks

Set these in Railway's **Health Check** settings for each service:

| Service | Health check path |
|---|---|
| `web` | `http://localhost:3000/health/live` |
| `api` | `http://localhost:3001/api/health` |

The `api` service also exposes `/health/live` (process only) and `/health/ready` (process + DB round-trip). Use `/api/health` for the Railway health check — it wakes the database if needed and reports connected/disconnected.

---

## 6. Persistent storage for uploads

**Everything is on Cloudinary.** Product images, media library uploads, avatars, and brand logos — all go to Cloudinary. No local disk needed, no persistent volume required.

The brand logo upload path (`backend/src/services/brandLogoService.ts`) was updated to upload to Cloudinary (matching `mediaService.ts`), so the local `./uploads/` directory and the `/uploads` static route are no longer needed for user uploads.

The only things on the local filesystem are:
- Static assets that ship with the build (`public/images/`, `frontend/dist/`), which are part of the deployed artifact — fine on Railway.
- Build-time output (prerendered HTML, sitemap) — written during the build step, served from `frontend/dist/` — fine on Railway.

No persistent volume is required.

---

## 7. Custom domains

The Hobby plan allows **1 custom domain per service** (Trial: 1 per workspace,
Pro: 20 per service). This project uses exactly two custom domains:

| Domain | Service | Railway host target |
|---|---|---|
| `alkatraders.co` (canonical, non-www) | `marine` | `l7nm3ssc.up.railway.app` |
| `api.alkatraders.co` | `api` | `c0qivzai.up.railway.app` |

`www.alkatraders.co` is **not** attached to Railway (no slot left on Hobby) —
do not point its DNS at Railway, or it will 404 / fail TLS.

### Hostinger DNS records

In hPanel → **Domains** → `alkatraders.co` → **DNS / Nameservers**:

| Type | Name | Value |
|---|---|---|
| CNAME (stored as **CNAME ALIAS**) | `@` | `l7nm3ssc.up.railway.app` |
| TXT | `_railway-verify` | `railway-verify=76ee0d19d070183cc435ffefa4ea1ae00a537cb7ae476e404e52d5167b2bedc0` |
| CNAME | `api` | `c0qivzai.up.railway.app` |
| TXT | `_railway-verify.api` | `railway-verify=d7cbf584c4883b1c4da9bbfd5cafe20b2b59589dd7680bc3596b421730f8c1f2` |

Keep the existing MX (`mx1/mx2.hostinger.com`) and SPF TXT records — email runs on
Hostinger. Delete the old root A/AAAA records (Hostinger parking IPs) before adding
the `@` ALIAS.

Notes:
- Railway requires **both** the CNAME/host record and the TXT verification record.
  Without the TXT record the domain resolves but returns `404`.
- Hostinger does not allow a plain CNAME at `@`; adding record type **CNAME** with
  name `@` saves it as an **ALIAS** and flattens it automatically — this is what
  Railway requires for root domains.
- If Hostinger CDN / Website Builder is attached to the domain it creates its own
  ALIAS on `@` — detach it first.
- Certificates are issued automatically within ~1 hour of DNS verification.
- To keep `www` usable, use hPanel → Domains → **DNS / Nameservers → Redirects**
  to 301 `https://www.alkatraders.co` → `https://alkatraders.co` (Hostinger
  redirects are HTTP-only unless the domain has hosting; otherwise just remove
  the old `www` CNAME record).

Until DNS propagates, use the `*.railway.app` URLs:
- Frontend: `https://marine-production-5b1c.up.railway.app`
- Backend: `https://api-production-d183.up.railway.app`

`VITE_API_URL` on the `marine` service is set to `https://api.alkatraders.co`
(baked into the bundle at build time) — redeploy `marine` after DNS is fixed if
the API URL ever changes.

---

## 8. Deploy flow summary

1. **Push to GitHub** — both services auto-deploy on push to `master`.
2. **Set env vars** on each service (see tables above).
3. **Provision Railway PostgreSQL** and point `DATABASE_URL` / `DIRECT_URL` at it.
4. **First deploy:**
   - Let both services build and start.
   - Run `npx prisma migrate deploy` + `npx tsx prisma/seed.ts` against the new DB (or restore from Neon with pg_dump/pg_restore).
   - Redeploy `api` so the generated Prisma client is up to date.
5. **Verify:**
   - `https://marine-production-5b1c.up.railway.app/health/live` → `{"status":"ok"}`
   - `https://api-production-d183.up.railway.app/api/health` → `{"status":"ok","database":"connected"}`
   - `https://api-production-d183.up.railway.app/api/v1/info` → API version info
   - Log in to `/admin` with your admin credentials.
6. **Point custom domains** at Railway when ready (update `VITE_API_URL`, `FRONTEND_URL`, `CORS_ORIGIN` to the custom domains).

---

## 9. What changed in the code for Railway

| File | Change |
|---|---|
| `backend/src/utils/prismaClient.ts` | Removed Neon HTTP/WS adapter logic. Now uses plain TCP Postgres via `DATABASE_URL`. Removed `@neondatabase/serverless`, `@prisma/adapter-neon`, `ws` dependencies. |
| `backend/package.json` | Removed Neon adapter deps. Added `db:migrate:deploy` script. |
| `backend/.env.example` | Replaced Neon config with Railway PostgreSQL. Added `SMTP_*`, `SALES_EMAIL`, `ADMIN_NAME`. Removed `DB_DRIVER`. |
| `.env.example` | Root frontend example now references Railway backend URL. Added note about not putting secrets in `VITE_*` vars. |
| `backend/src/server.ts` | CORS origins now honor `CORS_ORIGIN` env var as the source of truth in production (comma-separated). Added DB URL (redacted) to startup banner. |
| `server.js` | Removed Hostinger self-heal / on-the-fly-build / warm-up-page logic. CSP `connect-src` now reads `VITE_API_URL` at runtime so the same build works on any domain. |
| This file | Railway deploy guide. |

---

## 10. Local development after these changes

```bash
# Backend (with Railway-style Postgres URL in .env)
cd backend
npm run dev          # tsx watch src/server.ts  →  http://localhost:3001

# Frontend (separate terminal)
npm run dev          # vite → http://localhost:5173
                     # vite proxy forwards /api → http://localhost:3001
```

For local development you can keep using any PostgreSQL (local, Neon, or Railway) — set `DATABASE_URL` and `DIRECT_URL` in `backend/.env`. The driver is now always TCP, so any standard Postgres URL works.

---

## 11. Rollback plan

If something goes wrong on Railway:

1. Railway keeps previous deployments — click **Rollback** on the service to revert to the last working deployment.
2. If the DB migration caused issues, point `DATABASE_URL` back at Neon temporarily and redeploy — the backend handles Neon URLs the same way (TCP driver works for any Postgres).
3. Environment variables are versioned per service in Railway — you can diff/rollback individual vars.

---

## 12. Things to watch after deploy

- **Cold starts:** Railway PostgreSQL doesn't sleep like Neon's free tier, so the `/api/wake` endpoint is now a no-op health check (harmless). The cold-start retry logic in `prismaClient.ts` still works but is less likely to trigger.
- **Brand logos:** Brand logos are now uploaded to Cloudinary (same as the rest of your media). No persistent volume needed. If you see a brand logo disappear after redeploy, check that `CLOUDINARY_URL` is set correctly and that the logo URL in the DB is a Cloudinary URL.
- **Email:** SMTP credentials live in the Railway environment only. With SMTP unset, emails are recorded as `skipped` (never fake-`sent`); with SMTP configured, queue rows show the real delivery status.
- **PayPal:** If `PAYPAL_WEBHOOK_ID` isn't set in production, webhook signature verification is skipped (dev mode). Set it before going live.
