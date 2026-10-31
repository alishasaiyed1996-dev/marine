# Technical SEO + Full-Stack Audit — `marine` (Alka Traders)

> **Audit date**: 2026-10-29 · **Repo HEAD**: `f9bea5f` + working tree changes
> **Mode**: read-only. Nothing in the codebase was modified during this audit.
> **Method**: full reads of ~40 core files (server.js, shared/*.mjs, SEO components, prerender scripts, backend SEO-relevant services), targeted greps across all 60+ pages and components, git inventory checks (`git ls-files`, `git check-ignore`, `git log --all --follow`).

---

## Architecture summary (how this site serves)

- **Vite 8 + React 19 SPA** (`index.html`, `src/main.tsx`, `vite.config.ts`) with three rendering layers that read **one shared source of truth**:
  - `shared/product-page.mjs` — the product SEO engine
  - `shared/static-pages.mjs` + `shared/static-pages-i18n.mjs` — page meta
  - `shared/route-i18n.mjs` — hreflang + indexability policy (en/ar/es)
- **Build**: `npm run build` → vite build → `scripts/prerender.mjs --dist frontend/dist` (writes real per-product + per-locale HTML shells) → `scripts/copy-frontend.mjs`
- **Runtime**: `server.js` (Express 5, production frontend server) SSR-renders products/hubs using the same shared modules; adds canonicals, hreflang, X-Robots-Tag; merges API sitemap.
- **Hydrated React** re-emits identical meta via `src/components/seo/SEO.tsx` + `reconcileHead.ts` (dedupe).
- **Backend**: `backend/` (Express + Prisma) at `api.alkatraders.co` — sitemap source of truth (`backend/src/services/sitemapService.ts`), hub indexability gates (`hubSeo.ts`, `brandService.ts`, `categoryService.ts`), API-host `robots.txt` with `X-Robots-Tag: noindex` (`backend/src/server.ts:351-356`).
- Deployment targets referenced by the repo: Railway for the Node host (`frontend/dist`, `server.js`), Hostinger app modes documented in comments (`public/.htaccess` header, `frontend/.env.production`).

---

## Findings

Priority legend: **H** = act soon, **M** = fix when convenient, **L** = hygiene.

### H-1 · Apache static-mode `.htaccess` can turn every unknown URL into a 200 soft-404

- **Location**: `public/.htaccess:24-25`
  ```apache
  # Everything else → SPA shell
  RewriteRule ^ index.html [L]
  ```
- **Evidence chain**: `server.js` serves *true* 404s for dead slugs and noindexes its fallback shells. `public/404.html` exists, but `.htaccess` never references it (no `ErrorDocument` line anywhere in the file, lines 1-31). If Hostinger runs in **Apache static mode**, any typo'd / deleted / never-prerendered URL returns the index shell with **HTTP 200** and an indexable head — the exact soft-404 trap the Node mode exists to prevent.
- **Honest limits**: this file is only live when Hostinger runs in Apache static mode. Which mode is actually active cannot be verified from the repository — in Node mode (`server.js`) the `.htaccess` is inert. Structural limit: Apache-only hosting cannot distinguish "unknown product slug" (soft-404) from "prerendered product file" via rewrite rules alone; it works here only because the prerender script puts every sitemap product on disk.
- **Proposed fix**: tie `.htaccess` to the same route policy as `server.js` — serve prerendered files as-is (already done, lines 14-17), explicitly list the SPA route set, and add `ErrorDocument 404 /404.html` so everything else gets a genuine 404 status — or document static-mode as dev-only.

### H-2 · Live production secrets sit in local `.env` files — never committed, but one command from leaking

- **Location**: `.env.production` (repo root, local-only file)
  - `DATABASE_URL` / `DIRECT_URL` with a real Neon password (lines 8-9)
  - `JWT_SECRET` **identical to** `CSRF_SECRET` (lines 12-13) — two mechanisms sharing one key
  - `ADMIN_PASSWORD=admin123` (line 19)
  - `PAYPAL_MODE=live`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (lines 30-33)
  - `CLOUDINARY_URL` including API secret (line 51); also present in `.env` line 7
- **Verified safe state** (what I actually checked):
  - `git ls-files` shows only `.env.example` variants are tracked in the repo
  - `git check-ignore -v` confirms `.env`, `.env.production`, `backend/.env` are all gitignored
  - `git log --all --follow` shows `.env.production` and `backend/.env` were **never committed** — no repo leak exists today
- **Impact**: a force-add, a backup sync, or "add everything" muscle memory publishes the production database and payment integration. These files live under `Downloads\`, a commonly cloud-synced folder. JWT/CSRF key reuse means a single leak undoes both mechanisms.
- **Proposed fix**: rotate all listed values (treat the machine copy as exposed), move them to provider env dashboards, use distinct JWT vs CSRF secrets, strengthen the admin password. No code change required beyond `.env.example` guidance; rotation itself happens in provider dashboards.

### M-1 · `/brands/` marquee: 940 `<img>` elements from a hardcoded 470-URL Cloudinary list, filename-based alt text, 800px variants fetched for 112px tiles

- **Location / evidence**:
  - `src/data/brandImages.ts` — 470 raw Cloudinary URLs
  - `src/pages/Brands.tsx:105` — `{[...row, ...row].map(...)}` duplicates each of the 4 rows in DOM → **940 image elements** on an *indexable* static route
  - `src/pages/Brands.tsx:108` — tiles are `w-24 h-24` (112px box); no `sizes` prop is passed, so `srcSet` is never built (`OptimizedImage.tsx:90`: `srcSet={sizes ? ... : undefined}`), and the default `transformWidth = 800` (`OptimizedImage.tsx:76`) applies → every tile requests an **800px Cloudinary variant**
  - `src/pages/Brands.tsx:112` — `alt={'${filename} brand logo'}` → strings like `imgi 236 footer-logo brand logo`
  - the list includes **non-brand images** `imgi_236_footer-logo.png` and `imgi_237_payments.png`
  - `src/pages/Brands.tsx:78` — renders `{brandImages.length}+ Brands We Work With`; the "470+" claim is inflated by the two non-brand entries
  - the section is decorative but not marked as such (no `aria-hidden` on the marquee container, real alt text implies content)
- **Impact**: crawl/bandwidth/DOM overhead on an English canonical page; noisy alt text; footer-logo and payments images pollute image search semantics. Actual transferred bytes were **not** measured — that requires a live page run.
- **Proposed fix**: mark the marquee `aria-hidden="true"` with `alt=""`; prune the 2 non-brand files; use width-matched transforms (`transformWidth={112}` + `sizes`); avoid DOM duplication of rows; correct the count; optionally link tiles to matching DB brand slugs.

### M-2 · Product JSON-LD asserts `UsedCondition` whenever the condition field is empty or unrecognized

- **Location**: `shared/product-page.mjs:1632-1643`
  ```js
  function mapCondition(condition) {
    switch (cleanText(condition).toLowerCase()) {
      case 'new': case 'unused':               return 'https://schema.org/NewCondition'
      case 'refurbished': case 'reconditioned': return 'https://schema.org/RefurbishedCondition'
      default:                                  return 'https://schema.org/UsedCondition'
    }
  }
  ```
  Consumed at `product-page.mjs:1423` (Offer) and `:1782`. This engine simultaneously feeds `server.js`, the prerender, and `ProductDetail.tsx`.
- **Impact**: a product with a missing/misspelled condition ships structured data claiming **"Used"** while the visible page may never say so — a merchant-listing accuracy mismatch on pages where the Offer block matters.
- **Proposed fix**: return `null` for unknown/missing values and omit `itemCondition` from the Offer (silence is the schema-safe default), keeping the known mappings.

### L-1 · ItemList JSON-LD hardcodes English item URLs on AR/ES listing renders

- **Location**: `src/pages/Products.tsx:335` — `url: \`https://alkatraders.co/en/product/${product.slug || product.id}/\``
- AR/ES catalog views are noindex per `shared/route-i18n.mjs`, so this is schema-accuracy trivia today. Fix: build item URLs with the same locale-aware helper the canonical uses.

### L-2 · Home `CollectionPage` passes raw strings where schema expects Things

- **Location**: `src/pages/Home.tsx:112` — `about: highIntentSearches`, where `highIntentSearches` (`Home.tsx:38`) is a `string[]`. Schema.org `about` expects `Thing`/URL objects.
- Fix: map to `{ "@type": "Thing", "name": term }`.

### L-3 · Stale local `dist/` artifacts (not committed, not serving)

- `dist/robots.txt` is an old variant missing the newer Disallow lines (`/checkout`, `/account`, `/search`) present in `public/robots.txt`; `dist/_redirects` is a leftover Netlify directive. Verified gitignored (`git ls-files`); live traffic comes from `frontend/dist` via Railway. Fix: delete locally.

### L-4 · Orphaned `src/pages/Shop.tsx`

- Zero imports anywhere (grep-verified) yet it carries its own duplicate `canonical="/products/"` (`Shop.tsx:96`). Dead-code maintenance trap. Fix: delete the file.

### L-5 · Maintenance gate render path unverified

- `src/pages/Maintenance.tsx` renders without a `SEO`/noindex meta, and no server-side maintenance enforcement was found in what was read of `server.js`. If maintenance mode is ever enabled on an Apache static deployment, prerendered indexable HTML may keep serving while the app shows nothing. Flagged as *verify at runtime*, not as a code defect claim.

---

## What's working well (verified, not flattery)

1. **Single-source-of-truth SEO** — `shared/*.mjs` drives `server.js`, the prerender, the React pages, and the sitemap identically. The backend copy `backend/src/utils/routeI18n.ts` is a **test-enforced duplicate** (`backend/src/__tests__/routeI18n.test.ts` asserts list equality, so the sitemap can never advertise a translated URL the storefront refuses to index).
2. **True 404s end-to-end in Node mode** — server 404 + noindex fallback shells; per-product noindex on render-failure (`src/pages/ProductDetail.tsx:141-144`); hub error states noindexed (`src/pages/BrandHub.tsx:36`, `src/pages/CategoryHub.tsx:35`); API-host `robots.txt` + `X-Robots-Tag` (`backend/src/server.ts:351-356`).
3. **Consistent URL policy** — trailing-slash canonicals everywhere via `useLocalizedPath`; **zero** raw internal `<a href="/…">` anchors in storefront pages (grep-verified; only admin screens use real anchors, correctly for full page loads); all 6 `target="_blank"` hits carry `rel="noopener noreferrer"`.
4. **Shared indexability gates** — the hub noindex decision is computed in backend services and reused by the sitemap, so a hub can never be noindex in HTML yet appear in the sitemap (`backend/src/services/sitemapService.ts:69`, `brandService.ts:76`, `categoryService.ts:94`). The frontend admin mirror `src/lib/seo/hubSeo.ts` matches backend rules (`src/lib/seo/hubSeo.ts:3-12`).
5. **CLS/priority discipline in product imagery** — `src/components/product/ProductImageGallery.tsx:235-243`: eager + `fetchPriority="high"`, explicit 1200×1200, aspect-square stage; `ProductCard`/`RelatedProducts` use lazy loading with aspect-ratio boxes; meaningful `sizes` strings where used.
6. **Consent-gated analytics** — `src/components/CookieConsent.tsx` adopts the prerendered banner node instead of repainting it (LCP rationale documented in comment lines 19-32); the banner genuinely gates analytics.
7. **Wart-hardened infrastructure** — PWA `navigateFallback: null` in `vite.config.ts` kills the stale-service-worker shell trap; SSR burst protection documented in `backend/src/server.ts:68-70,216` + `backend/src/middleware/rateLimit.ts` (503 + noindex outage shell, crawler-exempt worker path); `public/early-product.js:10-26` early fetch is hostname-gated and one-shot so it never serves stale data.
8. **Self-audit tooling exists and is wired into npm scripts** — `seo:audit`, `index:audit`, `gsc:audit`, `catalog:audit` (`package.json:20-24`), `scripts/mobile-probe.mjs`, `scripts/warm-cloudinary.mjs`, plus regression tests `tests/*.test.mjs` (hreflang, host-canonicalization, hub-coverage). Most of this codebase has already survived a serious internal audit pass — and it shows.

---

## Uncommitted working-tree state (observed at audit time)

Modified, uncommitted: `scripts/fetch-products.mjs`, `scripts/prerender-locales.mjs`, `scripts/prerender-routes.mjs`, `scripts/prerender.mjs`, `server.js`, `shared/static-pages-i18n.mjs`, `shared/static-pages.mjs`. Untracked: `SEO_SEOBILITY_RESPONSE.md`, `argon_seo.md` (this file).

---

## What this audit cannot verify (stated plainly)

- **Live edge/headers**: which Hostinger app mode is active (H-1's real-world impact), live response headers, redirects, CDN config, per-account Cloudinary delivery parameters.
- **Google-side state**: Search Console coverage, Google's chosen-canonical drift, field/Core Web Vitals (CrUX) data.
- **Database contents**: real product `condition` values (M-2's hit rate), hub SEO field completeness in production, actual brand slugs in the DB vs the marquee image list.
- **Measured performance**: actual payload weight of `/brands` (M-1) or any Lighthouse/CWV number. A live run is required — none was performed.

---

## Proposed fix plan (proposed only — not implemented)

- **Phase 1 — quick code fixes**: delete `src/pages/Shop.tsx` + stale root `dist/` artifacts; `shared/product-page.mjs` mapCondition returns null for unknown and omits `itemCondition`; locale-aware ItemList URLs (`Products.tsx:335`); Home `about` as `Thing` array.
- **Phase 2 — Brands marquee rebuild**: `aria-hidden` decorative marquee with `alt=""`; prune non-brand entries; `transformWidth={112}` + `sizes`; no DOM row duplication; corrected count; optional slug-matched links.
- **Phase 3 — hosting policy tie-in**: rewrite `public/.htaccess` around prerendered-file-first + explicit SPA route list + `ErrorDocument 404 /404.html`; document static-mode limits inline.
- **Phase 4 — ops/security hygiene**: rotate the H-2 credentials, distinct JWT/CSRF secrets, strong admin password, move values to provider dashboards; update `.env.example` guidance.
