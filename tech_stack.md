# Tech Stack — Alka Traders (alkatraders.co)

_One monorepo (this repo, `marine`), two deployable services built from it. Recorded 2026-10-28._

| Layer | Technology | Where it runs |
|---|---|---|
| Storefront web | React 19 + Vite 8 + SSR/static hybrid | Railway service `marine` → alkatraders.co |
| API | Express 5 + TypeScript + Prisma | Railway service `api` → api.alkatraders.co |
| Database | PostgreSQL (Prisma migrations) | Railway Postgres + 500 MB volume, private network (iad) |

## Runtime
- **Node.js ≥ 22**, pure ESM (`"type": "module"`) across both packages
- Linux containers on Railway (US-East `iad`), config-as-code in **`.railway/railway.ts`** (services, env vars with `preserve()`, healthchecks, `preDeploy: prisma migrate deploy`)

## Frontend (repo root)
- **React 19** + **TypeScript 5.8** (strict, solution-style `tsc -b`)
- **Vite 8** + `@vitejs/plugin-react`, **vite-plugin-pwa** (installable PWA)
- **react-router-dom 7** (locale-prefixed routes), **TanStack React Query 5**, **Zustand 5** (cart/store)
- **Tailwind CSS 3.4** + PostCSS/Autoprefixer, CSS-variable theming (dark/light)
- **Framer Motion 12**, **lucide-react**, **three.js + @react-three/fiber + drei + cobe** (3D hero/globe visuals)
- **i18next / react-i18next** — en/ar/es (RTL for Arabic) from `src/locales` + shared locale policy
- **react-helmet-async** (document head), **@paypal/react-paypal-js 10** (the only payment method), **@sentry/react** (client errors)

## Web service (`server.js` — plain Node, no SSR framework)
- Serves **1,113 prerendered static pages** (`scripts/prerender.mjs`) with a runtime SSR fallback for dynamic pages (`renderDocument`: canonical, robots, hreflang from the shared policy)
- Canonicalization middlewares: **http→https 301, www→apex 301**, duplicate-slash/locale-case collapse, legacy `.html` → extensionless 301s
- Hardened CSP (per-build nonces + hashes), crawl-policy headers, cache headers, SSR→API fetches with **`SSR_API_TOKEN`** + bounded timeout, health at `/health/live`

## Backend API (`backend/`)
- **Express 5.2**, **zod** validation per route, **pino/pino-http** structured logging (context child-loggers)
- **Prisma 6 + PostgreSQL** (Railway private network; `DIRECT_URL` for migrations)
- **Auth**: JWT access + refresh-cookie, bcryptjs, CSRF double-submit middleware, customer/admin roles, IP-keyed rate limiting (`trust proxy = 1` hop) + public/admin limiters
- **Domain services**: server-authoritative order pricing, atomic **central inventory** (reserve/decrement/release with race guards), slug-history 301s, product-content normalizer, sitemap service, offers/RFQ flows, audit log
- **Integrations**:
  - **PayPal** REST v2 (create/capture/refund, webhook signature verification + cert-URL SSRF guard) — live mode, USD
  - **eBay** marketplace sync (catalog import, quantity reconciliation scheduler, order-event webhooks)
  - **Resend** over HTTPS (Railway blocks SMTP) with nodemailer/SMTP fallback + `email_queue`
  - **Cloudinary** for media, **sharp** for image optimization

## Shared code (`shared/`)
Pure `.mjs` modules + `.d.ts` consumed by frontend, backend, prerenderer and sitemap alike — product-page builder, **route-i18n** (translated-routes / hreflang / indexability policy), static-page copy — so the layers can't drift.

## Quality & CI/CD
- **ESLint 10** (flat config, typescript-eslint, custom rules in `eslint-rules/`), **node:test** in both packages (root `tests/*.test.mjs`, backend `src/**/*.test.ts` via tsx)
- **Playwright 1.62** e2e (`e2e/`: admin product flow, image adapter)
- **GitHub Actions**: `ci.yml` (tsc + lint + build on PRs/push to master), `deploy.yml`
- **Deploy = merge to master** → Railway auto-deploys both services (api: build + `prisma migrate deploy` + `/api/health` gate; marine: build + `/health/live` gate); Railway CLI for ops (ssh, logs, variables)
- Ops/SEO scripts in `scripts/`: prerender, `index:audit` (all sitemap URLs), GSC audit, catalog audit, Cloudinary warmer

## Observability (current state)
- Boot/heartbeat logs with greppable lifecycle markers (`SERVER_STARTING`/`SERVER_LISTENING`/`APPLICATION_READY`)
- **Sentry**: code wired on both sides, DSNs pending (OWNER_ACTIONS §4)
- **GA4**: `rfq_submit` event live, key-event registration pending (§5)
