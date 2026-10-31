# Execution Report — Approved Phase 1–3 Batch

**Executed:** Thu 29 Oct 2026 (immediately after the clean live-DB verdict in `argon_seo3.md`)
**Result:** ✅ ALL DONE — `npm test` 65/65 pass · `npm run typecheck` clean · constraint list respected

---

## Changes applied (exact scope)

### M-2 — condition mapping (`shared/product-page.mjs`, `shared/product-page.d.ts`)
- `mapCondition()` now maps explicitly: `new`/`unused` → `NewCondition`, `refurbished`/`reconditioned` → `RefurbishedCondition`, `used` → `UsedCondition`; unknown/blank → `undefined`. Extensive comment records the 5-value value-space proof and why marketplace feeds keep their mandatory conservative fallbacks.
- Offer JSON-LD (~line 1540): `itemCondition: conditionSchema` → conditional spread `...(conditionSchema ? { itemCondition: conditionSchema } : {})` — unknown/blank conditions omit the key entirely, mirroring `SEO.tsx:249–251`.
- `.d.ts`: `conditionSchema: string | undefined`; `mapCondition`/`mapProductCondition` return `string | undefined`.
- `conditionLabel` (display text) intentionally untouched.

### M-1 — Brands page weight (`src/pages/Brands.tsx`, `src/data/brandImages.ts`)
- Removed `imgi_236_footer-logo.png` and `imgi_237_payments.png` from the array (470 → 468 entries; no more 940 `<img>` nodes from a payment/footer widget screenshot inside the brand marquee).
- Marquee tiles now pass `sizes="112px"` and `transformWidth={112}` to `OptimizedImage` → Cloudinary returns the 112px rendition with an automatic 2× (224px) srcSet candidate instead of fetching 800px transforms for `w-24/w-28` tiles.
- Duplicated second-half of each row (`[...row, ...row]`, purely for the seamless CSS loop) is marked `aria-hidden="true"` with `alt=""`; primary tiles keep descriptive alt text with the `imgi_<number>_` prefix stripped.
- Seamless animation unaffected — the duplicated DOM remains; only its accessibility footprint changed.

### L-1..L-4 — cleanup
- Deleted orphan `src/pages/Shop.tsx` (zero imports; `server.js` already redirects `/shop` → `/en/products/`).
- Deleted stale root `dist/` (untracked legacy output; Vite's real `outDir` is `frontend/dist` per `vite.config.ts:125`).
- `src/pages/Products.tsx` ItemList JSON-LD: `https://alkatraders.co/en/product/…` → locale-aware `https://alkatraders.co/${language}/product/…`.
- `src/pages/Home.tsx` CollectionPage `about`: raw string array → `highIntentSearches.map((term) => ({ '@type': 'Thing', name: term }))`.

### H-1 — `public/.htaccess`
- Added `ErrorDocument 404 /404.html` (target file exists: `public/404.html`) with a comment: static-Apache mode relies on prerendered files on disk; Node mode runs `server.js` and ignores `.htaccess`.

### Tests (`tests/structured-data.test.mjs`)
- New test: `mapCondition maps the 5-value enum explicitly and omits unknown values` — asserts all 5 enum values map exactly, plus `""`/`null`/`undefined`/`"OEM"`/`"Overhauled"`/`"surplus — no grade"` produce `offers.itemCondition === undefined`.

## Test evidence

| Run | Result |
|---|---|
| `npm test` (first) | 65 tests: 60 pass / 5 fail — **all 5 in `tests/legacy-html.test.mjs`, `server.js exited early with code 1`** |
| `npm run typecheck` | clean |
| `npm test` (rerun) | **65/65 pass**, including all 5 legacy-html tests and the new mapCondition test |

The 5 first-run failures were a **pre-existing flaky port race**, not caused by this batch: `legacy-html.test.mjs` spawns `server.js` on `PORT = 46000…64000` while `host-canonicalization.test.mjs` runs on `42000…62000` (plus dev-mode `60000…64000`) — parallel test files can collide on `EADDRINUSE`, and the hook's `stdio:'ignore'` swallows the `FATAL [startup] listen failed` message (server.js:1422–1424), leaving only "exited early with code 1". Clean rerun confirms. (Optional future hardening, not applied — out of approved scope: disjoint port bands per test file or a bounded retry on EADDRINUSE.)

## Constraint compliance

`git status` after the batch — dirty-file list unchanged: `scripts/fetch-products.mjs`, `scripts/prerender*.mjs`, `server.js`, `shared/static-pages*.mjs` were **never touched**. New/modified by this batch: `public/.htaccess`, `shared/product-page.mjs`, `shared/product-page.d.ts`, `src/data/brandImages.ts`, `src/pages/Brands.tsx`, `src/pages/Home.tsx`, `src/pages/Products.tsx`, `tests/structured-data.test.mjs`, deletion `D src/pages/Shop.tsx`.

## Still pending (external, non-code)

1. Rotate `ADMIN_PASSWORD` and set distinct random `JWT_SECRET` ≠ `CSRF_SECRET` on Railway/Hostinger dashboards (per audit).
2. **Stale root `.env.production` DATABASE_URL** (found during the live check): its password is rejected by live Neon while `backend/.env.production` / `backend/.env` / `backend/.env.hostinger` authenticate. Update the root file with the current connection string so root-level scripts don't break.
3. Move live credentials out of any synced Downloads folder (OneDrive/Drive/backup).
4. Consider the optional test-runner port-band hardening above.
