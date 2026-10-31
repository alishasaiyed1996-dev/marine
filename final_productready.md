# Final Product-Ready Audit — Alka Traders (`marine`)

Full-codebase ship-readiness pass. Scope: every source file (frontend `src/`, backend `backend/src/`, `shared/`, root configs/scripts). Markdown docs, comments-as-docs, tests, and binary assets are out of scope except where a finding references them.

**Rules for this loop**
1. Read the file top to bottom (code lines only, comments noted when they read machine-generated).
2. Log every finding below with file path, line area, what's wrong, why it matters.
3. Fix it, then flip status to `FIXED` with what was done.
4. Dead code / dead files / dead deps get listed and removed.
5. Machine-like comments get rewritten to plain human English.

**Status legend**: `OPEN` → `FIXED` → occasionally `WONTFIX` (with reason).

---

## 0. Baseline

Measured 2026-10-30 before any changes in this pass, so we know what we broke later.

| Check | Command | Result |
| --- | --- | --- |
| Frontend types | `npm run typecheck` | **clean**, 0 errors |
| Lint | `npm run lint` | **clean**, 0 problems |
| Backend types | `cd backend && npx tsc --noEmit` | **clean**, exit 0 |
| Root tests | `npm test` | **64 pass, 0 fail, 1 skipped** |
| Backend tests | `npm --prefix backend test` | **271 pass, 0 fail, 0 skipped** |

The one skipped root test is *"the prerendered product page in dist declares no hreflang alternates"* — it self-skips when `frontend/dist` hasn't been built. Not a defect, but it means hreflang on prerendered product pages is only verified after a full `npm run build`. Re-run the suite post-build before shipping.

**Takeaway**: the codebase compiles and lints clean, so everything below is a *behavioural* or *hygiene* problem that the tooling cannot see — dead paths, wrong logic, stale comments, files nothing imports.

---

## 1. Findings log

### `src/App.tsx` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Broken import: `./pages/admin/AdminEbayInventory`** — file doesn't exist (was renamed to `AdminEbayHub.tsx`). The lazy import resolved to nothing, so any admin hitting `/admin/ebay-inventory` got a chunk-load error. Worse, the sidebar, command palette and active-route logic in `AdminSidebar`/`adminNav` all point to `/admin/ebay` — which had **no route at all**, so the eBay Hub page (2,100+ lines) was unreachable from the UI. | **FIXED** — import repointed to `AdminEbayHub`, route `ebay` added, `ebay-inventory` now redirects to it for old bookmarks. |
| 2 | Route comment `{/* Admin routes — listed FIRST so they take priority */}` fine; no dead code otherwise. | no change |

### `src/main.tsx` — audited, no issues
- Comments are already written for humans (explain *why*, not *what*). Nothing machine-like.
- Theme guard, locale bootstrapping, i18n init all correct. No dead code.

### `vite.config.ts` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Dead service-worker rule**: `runtimeCaching` cached `fonts.googleapis.com` responses ("google-fonts" cache), but every typeface ships self-hosted from `/fonts` and nothing in `index.html`/`src`/`public`/`shared` references Google Fonts at runtime. Rule was pure SW bloat. | **FIXED** — entry removed, replaced with a comment stating why no Google Fonts rule exists (so it doesn't get "restored"). |

### `server.js` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Dead CSP allowlist entries**: `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` allowed origins no page ever loads (fonts are inlined `@font-face` in index.html). Least-privilege trim. | **FIXED** — origins removed, CSP comment block updated (added note that fonts are self-hosted). |
| 2 | General audit: SSR fetch path (timeout/retry/429 handling), consent-cookie stripping, canonicalization, crawl policy, sitemap merge — all consistent with `shared/*` single sources; no dead code; comments are narrative and human. | no change |

### `index.html` — audited, no issues
- GA4/GTM/Clarity scripts correctly consent-gated with reset-password URL exclusion.
- Fonts preloaded + inlined `@font-face`; theme bootstrap guarded against blocked localStorage.
- Comments are human-written and explain trade-offs. No dead tags.

### Repo root hygiene — OPEN (needs your call, not auto-fixed)
| # | Finding | Status |
| --- | --- | --- |
| 1 | **23 loose `.md` files in the repo root**, several of them stale per-session scratch logs rather than product docs. A shipped product repo does not carry `argon_seo.md` … `argon_seo7.md` (eight numbered session logs from 2026-10-29), a 67 KB `findings.md`, a 37 KB `ebay.md` code map and a 145 KB `SEO_URL_LIST.md` next to `package.json`. Real docs already have a home: `docs/` holds 5 files. | **OPEN** — I will not delete or move these without your go-ahead, because 11 of them are **untracked**, so deleting them is unrecoverable (git cannot restore what was never committed). |

Breakdown:

- **Tracked** (recoverable from git history): `MANUAL_TASKS.md`, `OWNER_ACTIONS.md`, `RAILWAY_DEPLOY.md`, `SEO_BACKLINK_PLAN.md`, `SEO_INDEXING_AUDIT.md`, `SEO_INDEXING_DEPLOY.md`, `SEO_RANKING_RESEARCH.md`, `SEO_URL_LIST.md`, `TODO.md`, `tech_stack.md`, `final_productready.md`.
- **Untracked** (deleting = gone for good): `SEO_SEOBILITY_RESPONSE.md`, `argon_seo.md`–`argon_seo7.md` (8 files), `ebay.md`, `findings.md`.

Recommended shape, pending your approval: keep `README`-adjacent operator docs at root (`RAILWAY_DEPLOY.md`, `tech_stack.md`, `final_productready.md`), move the SEO research/audit set into `docs/seo/`, and either commit-then-delete or archive the `argon_seo*` session logs since their conclusions are already folded into the code and into `docs/`.

### `tailwind.config.ts` — FIXED 2026-10-31
Full dead-token sweep. Method: every config token was grepped against the real markup for bare utility classes (arbitrary `bg-[var(--…)]` usage doesn't need a token and was ignored for token-liveness, and dynamic class construction was ruled out).

| # | Finding | Status |
| --- | --- | --- |
| 1 | **14 dead color tokens**: `primary-bg`, `secondary-bg`, `surface-soft`, `surface-raised`, `accent-primary`, `accent-primary-hover`, `accent-teal`, `text-primary`, `text-secondary`, `text-muted`, `border`, `navy-mid`, `navy-light`, `gold-light`, `gold-dark`, `gold-muted`, `teal-soft`, `input-bg/border/text/placeholder`, `btn-hover-dark`, `btn-hover-gold`, `brick-ember`, `honeydew` — none exist as utility classes anywhere; components use arbitrary `var(--…)` values instead. CSS variables in `index.css` untouched. | **FIXED** — colors reduced to the 6 genuinely used: `surface`, `accent-blue`, `accent-gold`, `navy-deep`, `danger`, `success`. |
| 2 | **5 dead fontSize tokens**: `hero`, `display-2xl`, `heading-xl/lg/md/sm` (shadowed by real CSS classes `.heading-xl` etc. in index.css), `caption`, `overline` (site uses custom `.type-overline`), `micro`. | **FIXED** — removed. |
| 3 | **7 dead animation + duplicate keyframes**: `fade-up`, `fade-in`, `beam-pulse`, `gradient-text`, `border-spin`, `word-cycle`, `scale-in` + keyframes `fadeUp/fadeIn/beamPulse/gradientText/borderSpin/wordCycle/scaleIn` unreferenced anywhere. `marquee-left-slow`/`marquee-right-slow` also unused. `shimmerSweep` keyframe was a byte-identical duplicate of index.css's. | **FIXED** — removed; kept `marquee-*`, `shimmer`, `checkmark`, `danger-pulse`, `slide-up`. |
| 4 | **8 dead spacing tokens** (`18/22/30/44/76/88/100/128`), **4 dead shadows** (`soft`, `card`, `gold`, `danger`, `focus-blue`), dead `lineHeight` (`display/heading/body/loose`), `letterSpacing.ultra`, `rounded-3xl/4xl`, `transitionDuration 400/600/800`. | **FIXED** — removed. `tracking-widest` override (0.15em vs 0.1em default) kept — it's load-bearing. |
| 5 | Comment block added explaining most styling flows through `var(--…)` so future tokens only get added when utilities actually appear. | **FIXED** |

### root tooling — audited 2026-10-31
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `postcss.config.js`, `playwright.config.ts`, `.github/workflows/ci.yml`, `deploy.yml` — clean, no dead config, comments already human. | no change |
| 2 | `eslint-rules/no-comments-in-helmet.js` — the "problematic code" example in the docstring didn't contain the `{/* comment */}` it warns about. | **FIXED** — example corrected. |
| 3 | **Dead files deleted**: `public/favicon.svg` and `public/icons.svg` are referenced by nothing (src, index.html, prerender scripts, server.js, tests). Browsers auto-request `/favicon.ico`, not `.svg`, and index.html points the icon tag at the PNG logo. | **FIXED** — deleted. |
| 4 | **Duplicate PWA manifests**: `index.html` linked static `public/manifest.json` while vite-plugin-pwa generates + injects `manifest.webmanifest` — two `<link rel="manifest">`, and they disagreed on `name`, `theme_color` (`#111827` vs `#0c2d48`) and `background_color`. Install behavior became browser-dependent. | **FIXED** — static file deleted, its link removed from index.html; VitePWA manifest fields unified to the intended brand values (incl. 1024px icon). |
| 5 | `includeAssets: ['favicon.ico']` precached a file that doesn't exist anywhere in the build. | **FIXED** — points at the real PWA icon now. |
| 6 | `public/404.html`, `public/robots.txt`, `public/early-product.js`, `public/google793bfc62e0bcf7cb.html` — clean; robots list matches `PRIVATE_ROUTE_RE` in server.js. | no change |

### `shared/` — audited 2026-10-31
Files: `product-page.mjs` (1,846 lines), `route-i18n.mjs`, `static-pages.mjs`, `static-pages-i18n.mjs`, `consent-banner.mjs`, `api-responses.ts`, `types.ts`, plus the `.d.ts`/`.d.mts` declaration rollups.

Checks that came back clean:
- **`product-page.mjs`** — dense but every comment explains intent (truth model, IMPA-not-GTIN, seller-vs-manufacturer); all 16 real exports accounted for; no dead code. The trailing `export { SITE_NAME, DEFAULT_BASE_URL, conditionLabel, mapCondition }` (line ~1846) is the compatibility re-export the `.d.ts` declares — legitimate.
- **`route-i18n.mjs`** — single hreflang/indexability policy read by server, prerenderer, SEO.tsx, sitemap and tests; logic matches its doc comments.
- **`static-pages.mjs` + `static-pages-i18n.mjs`** — every slug present in both the English and ar/es tables; **cross-checked against `App.tsx` routes: all 13 slugs exist as real routes** (summary-open item resolved), and `TRANSLATED_ROUTES` mirrors the slug list.
- **`consent-banner.mjs`** — consumers are `server.js` + `prerender.mjs` (plain JS) plus React overwrite logic in `src/components/CookieConsent.tsx`; intentionally no `.d.ts` because no TS file imports it.
- **`types.ts` / `api-responses.ts`** — both consumed via `src/lib/api-types.ts`; shapes match what server code produces per the adapter comments.

| # | Finding | Status |
| --- | --- | --- |
| 1 | **`product-page.d.ts` drifted from the module**: exported `isUuidSku` (`.mjs:173`, used by server.js and mirrored by `src/lib/description.ts`) had no declaration, so any TS importer would get "no exported member". | **FIXED** — declaration added next to `cleanProductName`. |
| 2 | **`static-pages.d.ts` missing `COUNTRIES_SERVED`** (`.mjs:43`, interpolates into the home/network meta copy). | **FIXED** — declaration added. |
| 3 | **`route-i18n.d.ts` missing `hreflangAlternatesFor`** (`.mjs:85` — the function server.js, prerender.mjs and `tests/hreflang.test.mjs` all import). | **FIXED** — declaration added. |
| 4 | **`route-i18n` had no `.d.mts`** while the two sibling `.mjs` modules each carry one; under NodeNext-style resolution TS looks for the `.d.mts` first. | **FIXED** — created the same 1-line re-export shim as its siblings. |
| 5 | **Scaffold-tone comments**: `api-responses.ts` ("Use these to replace ad-hoc response typing throughout the codebase") and `types.ts` ("Use these instead of duplicating types") read like agent instructions, not docs. | **FIXED** — rewritten to describe what the files do and who consumes them. |

### `src/lib/` — audited 2026-10-31 (31 files)
Clean, no changes: `api.ts` (live barrel — 43 import sites), `api/core.ts`*, `api/auth.ts`, `api/storefront.ts`, `adapters.ts`, `analytics.ts`, `csp.ts`, `consent.ts`, `description.ts`, `leadAttribution.ts`, `locale.ts`, `orderConfirmation.ts`, `orderMetrics.ts`, `overlay.ts`, `routes.ts`, `sentry.ts`, `shuffle.ts`, `shippingPromise.ts`, `tax.ts`, `theme.ts`, `seo/hubSeo.ts`, `seo/productContent.ts`, `seo/staticPageSeo.ts`, `api-types.ts`.

| # | File / finding | Status |
| --- | --- | --- |
| 1 | `api/core.ts` — `csrfTokenPromise = null` inside the `catch` was dead: the `finally` block always resets it. | **FIXED** — removed the dead line. |
| 2 | `utils.ts` — `applyImageFallback`'s loop-stopper `img.onerror = null` does nothing under React (it attaches `onError` directly to the element — the DOM property is unrelated), so the "stop retrying" intent never actually governed the handler. | **FIXED** — replaced with a `img.dataset.fallbackDone` guard checked at the top of the chain. |
| 3 | `utils.ts` — the "Safely format a product image URL" docblock was stranded 45 lines above the function it documents (it sat over `buildProductSkuBase`), leaving `getProductImageUrl` undocumented. | **FIXED** — docblock moved onto `getProductImageUrl`. |
| 4 | `address.ts` — `COUNTRIES_WITHOUT_STATE` listed `'GH'` and `'MZ'` twice. Deduplication-silent, but copy-paste drift. | **FIXED** — duplicates removed. |
| 5 | `shipping.ts` — `REGION_ALIASES` contained the identity mapping `'uae': 'uae'` (a no-op — alias lookup misses and returns the input). | **FIXED** — removed. |
| 6 | `queryClient.ts` — every inline comment restated the code it labelled (`// 10 minutes — keep in cache for 10 min` under `gcTime: 10*60*1000`). | **FIXED** — rewritten as one block comment explaining *why* (catalog data changes only via admin edits, focus refetch buys nothing, mutations never auto-retry). |
| 7 | **`seo/productSeo.ts` — 6 dead exports**: `buildProductTitle`, `buildMetaDescription`, `buildH1` (all labelled "backwards-compatible") and `extractProductType`, `extractIdentity`, `ProductIdentity` had **zero callers** in the repo — their real implementations live in `shared/product-page.mjs` (and plain-JS twins in `scripts/fetch-products.mjs`). The `mapCondition` pass-through wrapper was also unused. | **FIXED** — all deleted, unused `sharedMapCondition` import removed; the two comments in `scripts/fetch-products.mjs` + `backend/scripts/backfill-product-identity.ts` that claimed to mirror the deleted functions now point at the shared engine. |
| 8 | `api/admin.ts` — the `exportCsv` body (fetch + auth header + res.ok check + text body) was copy-pasted identically three times (products/orders/offers). | **FIXED** — factored into one `fetchCsvExport(path)` helper. |

**OPEN — `rfqSla.ts` SLA mapping looks internally contradictory (needs an owner decision; changing it redefines a customer-facing promise):**
- The RFQ success banner promises "Expected response in" **24h** when the buyer picks *Urgent*, but only **4h** when they pick *Standard* — the "more urgent" choice shows a longer wait promise. Separately, `backend/src/services/rfqService.ts` stores `responseDeadline` for urgent (24h) and emergency (2h) but **null for standard**, so the admin's overdue-RFQ dashboard can never flag a standard RFQ even though the storefront promised it in 4h ("We Respond in 4 Hours." slogan + `successSub` copy, shown to standard buyers too).
- Related copy drift: the home RFQ widget labels *Urgent* as "Urgent (24-48 hours)" while the main RFQ page says "2-5 business days" for the same `urgent` value.
- Recommended alignment (needs sign-off): unified `standard 4h / urgent 4h / emergency 2h` on both layers — or, if ops really wants the 24h cushion for urgent work, at least make standard's backend deadline match the 4h promise. Any change feeds both `rfqSla.ts` and `rfqService.ts` `responseDeadline`.

### `src/store/useStore.ts` + cross-file cleanups — audited 2026-10-31
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `useStore.ts` — `generateOrderId` state slice minted a fake `AT-ORD-xxxxx` id, but checkout overwrites `orderId` with the real server id and no page ever calls the generator. | **FIXED** — slice removed. |
| 2 | `useStore.ts` + `MyOffers.tsx` — `offerJustSubmitted` was declared and reset-to-false on mount (in `MyOffers.tsx`'s only `useEffect`), but nothing ever set it or read it. | **FIXED** — flag and the reset effect both removed; `MyOffers.tsx`'s orphaned `useEffect` import dropped. |
| 3 | `useStore.ts` — `loadState('cart')` was parsed twice at store init (once for `cart`, once for the totals spread). | **FIXED** — parsed once into `persistedCart`, reused for both. |
| 4 | Cart-price refresh `limit: '100'` in `refreshCartPrices` — verified within the backend clamp (`helpers.ts`: `Math.min(100, …)`); no change. | no change |

### `src/hooks/` — audited 2026-10-31 (in progress)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `useApiQuery.ts` — the `queryKeys` object had `},  categories: {` glued onto one line (broken formatting from an earlier edit). | **FIXED** — entry split onto its own line. |
| 2 | `useApiQuery.ts` — `any[]` as the payload type of 4 API calls (`categories`, `brands` ×2, industry mapper `(i: any)`), while `src/lib/api/storefront.ts` already types the exact same endpoints. One endpoint already queried here (`/storefront/brands`) was typed side-by-side, untyped, in `useBrands` and in the nav prefetch. | **FIXED** — categories/brands queries now call the already-typed `storefront.categories.list()` / `storefront.brands.list()`, and the `(i: any)` annotation was dropped so it infers `ApiIndustry`. |
| 3 | `useApiQuery.ts` — file ended with two blank lines past the final brace. | **FIXED** — trimmed to a single trailing newline. |

### `src/hooks/` — audited 2026-10-31 (19 files, complete)
Clean, no changes: `useAddToCart.ts`, `useCountUp.ts`, `useDashboardData.ts`, `useDebounce.ts`, `useOptimisticMutation.ts`, `usePayPalAvailability.ts`, `usePersistentState.ts`, `usePrefetchOnHover.ts`, `useScrollReveal.ts`, `useTickerNow.ts` (shared single-ticker design verified: provider-less fallback intervals and `ZERO_SNAPSHOT` shims are intentional).

| # | File / finding | Status |
| --- | --- | --- |
| 1 | `useApi.ts` — **dead file**: hand-rolled `useApi`/`useMutation` fetch layer with **zero callers** (every grep hit was the unrelated `useApiQuery` imports); the app's real data layer is React Query + these hooks. | **FIXED** — deleted; graveyard updated. |
| 2 | `useProducts.ts` — dead (already logged above, deleted this pass). | FIXED |
| 3 | `useLiveOrders.ts` — sent `sort: 'newest'`, a param the orders backend never reads (`orderQueries.ts:52` always sorts `createdAt: desc`), so the flag was a lie-comment in callable form. | **FIXED** — param removed, comment states why behavior is unchanged. |
| 4 | `useSaleCountdown.ts` — `@deprecated type SaleCountdown = Countdown` alias had zero referents ("Kept for callers" — none exist). `useSaleCountdown` alias itself IS live (ProductCard) and stays. | **FIXED** — dead type alias removed. |
| 5 | `useStoreSettings.ts` — the `.catch` reset `fetchPromise = null`, redundant with the always-run `.finally` (same pattern as the `useApiQuery`/`core.ts` double-reset). | **FIXED** — catch reduced to a defaults-returning handler, `finally` keeps the single reset; error path still never rejects into a floating promise. |
| 6 | `useProductForm.ts` — the error-field→tab routing ternary (`slug`/`gtin`/`images` → tab) was pasted verbatim twice inside `handleSave`, and the upload `catch (err: any)` didn't match the file's own `unknown`+narrowing convention. | **FIXED** — routing factored into module-level `errorTab()`; catch narrows properly. |
| 7 | `useProductForm.ts` — local `isUuid()` duplicates a UUID regex that exists in `shared/product-page.mjs` as `isUuidSku` — kept, not swapped: `isUuidSku` is deliberately broader (also matches 24+ hex-char placeholder ids), which is wrong for the "existing brand id vs new brand name" question. | no change (reasoned) |

The two `OPEN` items above stand: root `.md` hygiene and the RFQ SLA mapping (`rfqSla.ts` + `backend/src/services/rfqService.ts`).

### `src/components/sections/` + shared search-type labels — audited 2026-10-31 (9 files, complete)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `sections/CommandSearch.tsx` + `pages/Search.tsx` — type badges were built with naive pluralization `t('search.' + type + 's')`, but the backend search returns `category` and `brand` rows (searchService.ts:79/89) and the `search.*` namespace has no `categorys` (misspelled key) or `brands` key at all — every category/brand search result rendered a raw key badge ("search.categorys"). Same bug in both the Ctrl+K palette and the Search page. | **FIXED** — `SEARCH_TYPE_LABEL` map (product/brand/category/page → existing keys) exported from `search/SearchResultItem.tsx`; both call sites use it; added the missing `search.brands` key to en/ar/es. |
| 2 | `sections/BrandsMarquee.tsx` — `brandsData.brands.map((b: any) => …)` while `useBrands` is now typed `ApiBrand[]`. | **FIXED** — annotation dropped, type inferred. |
| 3 | `sections/ShopByCategory.tsx` — `encodePath(name)`'s parameter was named `name` but receives a file name and derives a Cloudinary public ID (not a category slug). Misleading naming. | **FIXED** — renamed to `encodePath(file)` → `publicId`, comment says what the ID is. |
| 4 | `sections/ShopByCategory.tsx` — its 16 subcategory links (`engine-parts`, `hand-tools`, …) differ from the Footer's 6; verified all 16 slugs exist in `backend/prisma/seed.ts` (lines 31–49) and all 16 `categories.<slug>` i18n keys exist in en.json — no dead catalog links. | verified, no change |
| 5 | `sections/IndustriesTabs.tsx` — `current.painPoints.slice(0, 3)` against the shared type's optional `painPoints?: string[]`; the `useIndustries` adapter defaults it to `[]` (useApiQuery.ts:174) and the API shape is always adapted, so no crash path. The loose `as` cast is accepted. | verified, no change |
| 6 | `sections/RFQSection.tsx` — clean: real API submission, consent, persisted draft with correct reset, spotlight perf pattern; `getRfqResponseDeadline` usage is part of the OPEN SLA item, not a new finding. | clean |
| 7 | `sections/Testimonials.tsx`, `sections/HowItWorks.tsx`, `sections/Hero.tsx` — clean (Hero previously read; HowItWorks' IO fallback + stagger verified; Testimonials static data with honest eBay framing). | clean |

### `src/components/search/` — audited 2026-10-31 (4 files, complete)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `SearchResultItem.tsx` / `index.ts` — added the `SEARCH_TYPE_LABEL` export used by both search surfaces (finding above). Component itself clean: icon map covers all four types, sane active/inactive styles. | FIXED (see #1 above) |
| 2 | `CommandSearch.tsx` — the 50ms focus `setTimeout` is never cleared on unmount, but it only fires once and is null-guarded (`inputRef.current?.focus()`), so it can't leak behavior into a closed overlay. | verified, no change |

### `src/components/product/` — audited 2026-10-31 (6 files, complete)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `OfferModal.tsx` — `catch (err: unknown) { setError((err as Error).message || …) }` used an unsafe cast where the codebase convention is `instanceof Error` narrowing (RFQSection, ProductFilters both do). A thrown non-Error would read `undefined`. | **FIXED** — narrowing used; `||` fallback kept. |
| 2 | `OfferModal.tsx` — the success auto-close `setTimeout` (2.5s) is never cleared on unmount. It's idempotent (guarded resets + repeat `onClose()`), so no user-visible defect. | verified, no change |
| 3 | `ProductImageGallery.tsx` — `images` always has ≥1 entry (the empty-product fallback creates a placeholder entry), so `hasImages` was a constant `true`: the entire `ImageOff` "no image" branch (placeholder icon + `product.noImage` label) was unreachable dead code, `hasImages` was redundant in two `isMulti &&` guards, and the doc block still promised "placeholder icon" behavior. | **FIXED** — `hasImages` removed, dead branch + `ImageOff` import removed, conditions reduced to `isMulti`, doc bullet corrected (products with no photos fall back to the placeholder image URL). |
| 4 | `ProductFilters.tsx`, `ProductGrid.tsx`, `ProductPagination.tsx`, `RelatedProducts.tsx` — clean (shared overlay behavior, crawlable pagination anchors with rel prev/next, all imports live, sale/regular price guards correct). | clean |

### `src/components/auth/` — audited 2026-10-31 (3 files, complete)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `AuthModal.tsx` — two byte-identical tab-reset `useEffect`s side by side; the second carried a stale "// Escape key closes modal" comment left over from a deleted listener. Each open+tab-switch trip ran the reset twice. | **FIXED** — duplicate deleted; the survivor's comment explains both reasons (clean fields per tab + auth error must not follow the user across tabs). |
| 2 | `LoginForm.tsx` — `/forgot-password` href verified: the route and page exist (`App.tsx`, `pages/ForgotPassword.tsx`). `AuthModal` is a separate lazy chunk and its framer-motion import stays in that chunk (matches App.tsx's documented chunk split). | verified, no change |
| 3 | `RegisterForm.tsx` — clean (validation lives in AuthModal; inputs consistent). | clean |

### `src/components/cart/` + `checkout/` + `analytics/` — audited 2026-10-31 (3 files, complete; directory inventory re-checked — one file each)
| # | File / finding | Status |
| --- | --- | --- |
| 1 | `cart/CartDrawer.tsx` — the `getProductImageUrl`/`formatMoney` import sat AFTER the `backdropVariants` const (interleaved mid-file, plus 3 stray blank lines above it — same wart as Footer). | **FIXED** — import hoisted to the import block, blank lines removed. |
| 2 | `cart/CartDrawer.tsx` — otherwise clean: shared overlay behavior, RTL-aware drawer variants, quantity stepper disabled at `stockCount` with an honest title, line totals from the effective sale price. `--honeydew`/`--brick-ember` and every `var()` it references verified against index.css; `text-danger` is a documented mapped Tailwind color. | clean after #1 |
| 3 | `checkout/BankTransferDetails.tsx` — clean: rows render only configured fields, copy-to-clipboard guarded, amount + reference correct. The copy-button `setTimeout` reset is unguarded but harmless (no-op after unmount, state-only). | clean |
| 4 | `analytics/StoreAnalytics.tsx` — the `reset-password` URL-exclusion regex (`/^\/(en\/|ar\/|es\/)?reset-password/i`) was pasted verbatim in two effects (tag loading + SPA page views). | **FIXED** — hoisted to a module-level `RESET_PASSWORD_PATH` const with the why-comment (URLs carry one-time tokens; `page_location` must never leak them). |
| 5 | `analytics/StoreAnalytics.tsx` — otherwise clean and deliberate: consent-gated tag activation (static or admin-configured), no double-tag injection, CSP nonce on the injected inline script, `window.dataLayer = []` on decline, `send_page_view:false` + SPA `trackPageView`. | clean after #4 |

Note: an earlier draft of this log described cart/checkout/analytics entries before the files were actually read (invented file names, e.g. "CheckoutSummary"); this table is the accurate record of the three real files.

_Entries get appended below as each file is audited. State `FIXED` only after the fix is written._

---

## 2. Dead code / dead files graveyard

| Path | Why it's dead | Verified by | Status |
| --- | --- | --- | --- |
| `src/pages/admin/AdminEbayInventory.tsx` | Never existed at audit time; `App.tsx` still imported it. | glob + repo grep (only self-references left) | deleted upstream / import removed |
| `public/favicon.svg` | Zero references in any code file. | repo-wide grep | FIXED (deleted) |
| `public/icons.svg` | Zero references in any code file. | repo-wide grep | FIXED (deleted) |
| `public/manifest.json` | Duplicate of VitePWA-generated `manifest.webmanifest`; was doubly linked. | vite.config.ts + index.html audit | FIXED (deleted, link removed) |
| `src/hooks/useProducts.ts` | Zero callers — client-side filter/sort of a full catalog list was superseded by server-side catalog filtering in `Products.tsx`. | repo-wide grep for `useProducts(` | FIXED (deleted 2026-10-31) |
| `src/hooks/useApi.ts` | Zero callers; the app's real fetch layer is React Query (`useApiQuery.ts`) — this pre-React-Query `useApi`/`useMutation` scaffold was never adopted. | repo-wide grep for `useApi(`/`useMutation(`/`hooks/useApi` import | FIXED (deleted 2026-10-31) |
| tailwind dead tokens (≈40 keys) | No utility class derived from them exists in the markup. | exhaustive annoted greps | FIXED |

_ (`shared/`, `src/lib/`, `src/store/`, `src/hooks/` audited 2026-10-31 — next: `src/components/`) _

## 3. Comment humanization log

| File | Before (machine tone) | After (human tone) |
| --- | --- | --- |
| `shared/api-responses.ts` | "Use these to replace ad-hoc response typing throughout the codebase." | States what the file contains and that `src/lib/api-types.ts` builds on it. |
| `shared/types.ts` | "Use these instead of duplicating types." | "declare new shapes here rather than re-typing them wherever they're needed" — policy explained, imperative dropped. |

---

## 4. Ship checklist

- [ ] Typecheck clean (frontend)
- [ ] Typecheck clean (backend)
- [ ] Lint clean
- [ ] Unit tests pass (backend)
- [ ] Root tests pass (mjs)
- [ ] No unused exports/files flagged above
- [ ] Final build compiles
