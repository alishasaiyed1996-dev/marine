# Complete Codebase Fix

## Alka Traders — production-readiness research, findings, and fix plan

| Field | Value |
|---|---|
| Repository | `C:\Users\HP\Downloads\marine` |
| Site | `https://alkatraders.co` |
| API host | `https://api.alkatraders.co` |
| Audit date | 22 October 2026 |
| Audit type | Read-only source, schema, route, build, and deploy review |
| Working-tree HEAD | `d22e271 fix(pwa): allow service worker to fetch Cloudinary images` |
| Application changes | Applied incrementally. See **§15 Fix log** for what has been closed. |
| Evidence rule | Application code, routes, Prisma schema, server behavior, and build/deploy config are the source of truth. Markdown files and code comments were not trusted. |

> **Status legend:** `FIXED` = implemented in code and verified by typecheck/build. `IN PROGRESS` = partially addressed. `OPEN` = not yet started.

---

## 0. How to use this document

This is the complete research record and fix plan. It started as a read-only audit; it is now the working tracker for the fixes.

- **P0** items must be closed before the store takes real money or buys paid traffic.
- **P1** items should be closed before marketing scale.
- **P2** items are hardening and polish.
- Every finding has a stable ID (`U-`, `D-`, `S-`, `C-`, `X-`) so it can be tracked in an issue board.
- File references are `path:line` in the current working tree. Re-verify line numbers after edits.
- The audit reflects the working tree, not a tagged release. The working tree has uncommitted and untracked files, including a build-critical module. See D-0.
- **§15 Fix log** records every applied change with its verification.


---

## 1. Executive summary

**Verdict: not production-ready for real orders or paid traffic.**

The storefront looks like a credible specialist marine-parts supplier. The catalog structure, product detail pages, RFQ path, and Bhavnagar/Alang positioning give a visitor a reason to stay and read. The backend also has several solid security instincts: server-authoritative pricing, atomic stock helpers, webhook signature verification, Zod validation, audit logs, and CSP nonces.

The transaction layer does not match that trust layer:

1. **The checkout calls itself a demo.** It says “no real charges will be made” on the review screen.
2. **Bank transfer is the default and is unpayable.** No bank details are shown or emailed; the only instruction is that details will arrive later.
3. **No customer confirmation is sent at order placement.** The success page promises one. Bank-transfer customers hear nothing until an admin marks the order paid.
4. **PayPal can capture money before stock is secured.** If the stock decrement then fails, the order is reverted to pending after the customer has paid.
5. **The money math is inconsistent.** Tax, shipping, currency, and returns do not agree across checkout, terms, and email.
6. **A clean checkout cannot build.** `shared/product-page.mjs` is a 65 KB build-critical module that is untracked in git, yet imported by the server, prerenderer, and TypeScript app.
7. **Arabic and Spanish are served but explicitly de-indexed.** The UI offers languages that every SEO layer tells Google to ignore.
8. **A read-only admin (`viewer`) can read customer PII.** Admin read routes never enforce a role threshold.
9. **Password-reset tokens travel in URLs, logs, and analytics.**
10. **Checkout accessibility is broken.** Payment radios are `display:none`, and form labels are not associated with inputs.

**What is genuinely good:** the niche is clear, the product data is specific, the server owns prices, stock rollback exists, auth cookies are `httpOnly`/`SameSite=strict`, PayPal webhooks are signature-verified, and canonicalization is handled. This is a fixable build, not a rebuild.

**Readiness scorecard**

| Area | Status | Summary |
|---|---|---|
| Content and first impression | Amber | Niche is clear; trust proof contradicts itself |
| Checkout | Red | Demo copy, bank dead end, inaccessible payment radios |
| Payments and stock | Red | Capture/decrement race; bank stock only on paid |
| Pricing and tax | Red | Conflicting rates, currencies, and terms |
| Order communications | Red | No confirmation at placement; refresh loses the confirmation |
| English SEO | Green/Amber | Good technical foundation; false return schema |
| Multilingual SEO | Red | AR/ES noindexed, no hreflang, English-only sitemap |
| Accessibility | Red | Hidden radios, unlabeled fields, overlay collisions |
| Security | Amber | Good baseline; RBAC, token-lifecycle, and reset gaps |
| Analytics | Red | GA ignores consent; no SPA or ecommerce events |
| Test and deploy | Amber/Red | No CI tests; non-blocking typecheck; two servers; untracked build module |
| Launch readiness | Red | Not ready for paid traffic or real orders |

---

## 2. Repository and deployment map

### 2.1 Top-level layout

| Path | Role | Notes |
|---|---|---|
| `src/` | React SPA | Storefront, account, checkout, admin, i18n, SEO component |
| `server.js` | Production frontend entry | 1,161 lines. CSP, canonicalization, prerender serving, sitemap proxy, URL logging, static serving |
| `frontend/server.js` | Second startable frontend server | 284 lines. Separate `frontend/package.json`; different Express major and behavior |
| `backend/src/` | Express API | Auth, orders, payments, inventory, offers, RFQs, settings, email |
| `backend/prisma/schema.prisma` | Data model | Orders, customers, products, offers, settings, admin users |
| `shared/product-page.mjs` | Shared product-page and JSON-LD engine | Used by root server, prerender, and SPA SEO. **Untracked in git** |
| `scripts/` | Build and SEO tooling | Prerender, sitemap, fetch, SEO audit |
| `.github/workflows/` | CI/CD | Builds only; does not run tests |
| `e2e/` | Playwright specs | Present but not run in CI |
| `public/` | Static assets | Includes a 52.8 MB `hero.mp4` copied into the build |
| `frontend/dist/` | Built frontend output | Served by the frontend server |

### 2.2 Runtime topology

- The browser visits `https://alkatraders.co`.
- The frontend Express server serves prerendered English HTML for known routes, the SPA shell for app routes, canonical redirects, `robots.txt`, and the sitemap.
- The browser calls the API at `https://api.alkatraders.co`.
- The backend is a separate deploy with Prisma/PostgreSQL.
- Admin is a client-side application under `/admin`; admin API routes live under the API host.
- Storefront and API deploy separately, so headers, caching, and CORS must be reasoned about per origin.

### 2.3 Checkout path

1. Cart to `/checkout`.
2. Shipping form: name, guest email, address, city, state, postal code, country.
3. Payment step: bank transfer or PayPal. Bank transfer is preselected.
4. Review step: totals, payment summary, “Place Order.”
5. `backend/src/routes/storefront/orders.ts` calls `orderService.createOrder`.
6. Order is created with `status: pending`, `paymentStatus: pending`.
7. PayPal: create/capture flow updates payment and stock.
8. Bank transfer: order stays pending until an admin marks it paid.
9. Success page reads in-memory order state and displays the order number and totals.

### 2.4 Admin path

- Admin login issues a short-lived access token and a 7-day refresh cookie.
- Admin routes use `authenticateAdmin`; mutations generally add `requireRole`.
- Read routes for orders, RFQs, settings, offers, and messages do not add a role threshold.
- The role hierarchy includes `viewer` at level 1.

### 2.5 Build and SEO path

1. Vite builds the SPA.
2. `scripts/prerender.mjs` writes English route shells and product pages.
3. `scripts/copy-frontend.mjs` copies output to `frontend/dist`.
4. The frontend server serves prerendered files for English and the SPA shell elsewhere.
5. `backend/src/services/sitemapService.ts` generates an English-only sitemap; the frontend merges static routes and proxies it.
6. AR/ES pages are served but marked `noindex` by header and meta.

### 2.6 Working-tree state

`git status --short` at audit time:

```text
 M backend/src/services/productContentNormalizer.ts
 M scripts/fetch-products.mjs
 M scripts/prerender.mjs
 M scripts/seo-audit.mjs
 M server.js
 M src/lib/adapters.ts
 M src/lib/seo/productSeo.ts
 M src/pages/ProductDetail.tsx
 M src/types/index.ts
?? SEO_BACKLINK_PLAN.md
?? docs/
?? scripts/railway-deploy-watch.ps1
?? shared/product-page.d.mts
?? shared/product-page.d.ts
?? shared/product-page.mjs
```

`git diff --stat` shows 9 modified files, 501 insertions, and 823 deletions. `shared/product-page.mjs` is 65,467 bytes and is not tracked. This is a release-reproducibility problem, not just a local convenience.

---

## 3. Method and evidence rules

### 3.1 What was treated as evidence

- TypeScript, TSX, JavaScript, and MJS source.
- Express routes and middleware.
- Prisma schema and migrations.
- Build scripts and Vite configuration.
- GitHub Actions workflows.
- Package manifests and lockfile-adjacent configuration.
- Rendered strings in locale JSON, because they are shipped UI.

### 3.2 What was not treated as truth

- Markdown documentation.
- Code comments.
- README claims.
- Comments that describe intended behavior but do not match runtime behavior.
- Any production database values or live-site behavior, because none were accessed.

Where a comment is mentioned in this document, it is because the code contradicts it, or because the comment is the only clue to intent. The code wins.

### 3.3 Severity scale

| Level | Meaning |
|---|---|
| **Critical** | Stop-ship. Direct revenue loss, payment/legal exposure, or a broken core journey. |
| **High** | Major conversion, security, SEO, or operational damage. Fix before scaling. |
| **Medium** | Important quality or scale issue. Fix soon after launch blockers. |
| **Low** | Polish and hardening. |

### 3.4 Limits

- No production database was queried. Any finding that depends on persisted settings is labeled.
- No live crawl, DNS, CDN, or payment-provider account was inspected.
- No email deliverability test was run.
- No dependency vulnerability scan, penetration test, or legal review was performed.
- The audit reflects the working tree. A clean clone of HEAD may differ materially, especially because `shared/product-page.mjs` is untracked.

---

## 4. Launch gates (P0)

| # | Gate | Why it stops launch | Status |
|---|---|---|---|
| 1 | Remove the “demo checkout” copy or move this build to staging | The final screen tells the buyer the order is not real | **FIXED** |
| 2 | Make bank transfer payable, or disable it | Default method never shows or emails bank details | **FIXED** |
| 3 | Send a customer confirmation at placement for every method | Success page promises an email the code does not send | **FIXED** |
| 4 | Make payment capture and stock decrement atomic, with auto-refund on failure | PayPal can capture before stock; order reverts to pending after money is taken | **FIXED** |
| 5 | Reconcile tax, shipping, currency, and returns with the terms | 8% vs 18%, $25 vs $15, free over $100 vs zone thresholds, USD vs product currency, free returns vs buyer-paid | **FIXED** |
| 6 | Add terms/privacy acceptance at checkout | No acceptance control or legal link anywhere in checkout | **FIXED** |
| 7 | Fix admin PII access and reset-token exposure | `viewer` can read PII; reset tokens in URL/logs/GA | **FIXED** |
| 8 | Decide AR/ES: index them or remove them from the switcher | UI offers languages Google is told to ignore | **FIXED** |
| 9 | Fix checkout accessibility and B2B fields | Keyboard/screen-reader users cannot complete checkout; freight buyers cannot supply phone/company/VAT | **FIXED** |
| 10 | Commit the shared product-page module and its types | A clean clone/CI cannot build or start the server | **FIXED** |

**All ten P0 launch gates are now closed.** Remaining work is P1/P2 — see §16.

---

## 5. Findings by persona

### 5.1 User / Visitor

The visual and content layer is the strongest part of the product. The transaction layer is where visitors leave.

#### U-1 — Critical — The checkout calls itself a demo

`src/locales/en.json:410` says:

> “Your payment information is secure. This is a demo checkout — no real charges will be made.”

It is rendered at the bottom of the review step, immediately beside “Place Order” (`src/pages/checkout/CheckoutReview.tsx:201-204`). The sentence contradicts itself: “secure” and “no real charges.” The visitor has already chosen products, entered an address, and selected payment. This is the exact moment the buy decision is made.

Even if the copy was intended for staging, it is in the production locale bundle and ships with the build. The effect is abandonment, or a customer who completes the order but does not believe it is real. Both increase support load and chargebacks.

#### U-2 — Critical — Bank transfer is the default and leads to a dead end

The payment state initializes to `'bank-transfer'` (`src/pages/Checkout.tsx:42`). If every configured method is disabled, the code re-adds bank transfer anyway (`Checkout.tsx:204-209`). The only instruction is:

> “Bank transfer details will be provided after you place your order.” (`src/locales/en.json:398`)

No bank details are rendered anywhere in `src/` except the admin settings defaults (`src/pages/admin/settings/types.ts:89`). No customer email is sent when the order is created: `createOrder` only calls the admin notification (`backend/src/services/orderMutations.ts:152-159`). The customer confirmation is sent only when an admin marks the order paid (`orderMutations.ts:286-288,488-502`).

A bank-transfer customer therefore gets an order number and a promise, but no account number, IBAN, SWIFT, or instructions. They cannot pay. This is the single biggest revenue leak in the build.

PayPal orders do send a confirmation on capture (`backend/src/services/paypalService.ts:530`). Bank transfer does not. The two payment methods have completely different post-purchase behavior.

#### U-3 — High — The success page promises an email and a delivery window the code does not deliver

`src/locales/en.json:412-413` says:

> “You will receive a confirmation email shortly. Estimated delivery: 5-7 Business Days.”

It is rendered for every order at `src/pages/checkout/CheckoutSuccess.tsx:83-85`. For bank transfer, no confirmation is sent at placement. For international freight, 5-7 days is not a credible blanket estimate; the terms describe Monday-Friday shipping and variable freight (`src/pages/TermsOfService.tsx:60`). The customer is told two things the system cannot guarantee.

#### U-4 — High — Unavailable lines are dropped after the order is created

`createOrder` skips products that are missing or unpublished (`backend/src/services/orderMutations.ts:59-80`). The checkout diffs the returned order against the cart, stores the skipped lines, creates the order, and clears the cart (`src/pages/Checkout.tsx:281-330`). The customer sees the dropped lines only on the confirmation page (`CheckoutSuccess.tsx:87-103`). By then the order exists and the cart is gone.

The behavior is also inconsistent: an out-of-stock line throws an error (`orderMutations.ts:79-80`), while a deleted or unpublished line is silently skipped. Two versions of “unavailable” produce two different experiences.

#### U-5 — High — The address form is not usable for international B2B

The shipping interface has no phone, company, or VAT/tax ID fields (`src/pages/checkout/CheckoutShipping.tsx:5-14`). State and postal code are required for every country (`src/pages/Checkout.tsx:227-228`; `CheckoutShipping.tsx:135-159`). The order schema has no phone, company, or VAT fields either (`backend/prisma/schema.prisma:332-364`).

Many destinations do not use a US-style state or postal code. A freight forwarder needs a phone and company name. A B2B buyer needs a VAT/tax ID for customs and invoicing. The checkout asks for less information than the business needs to ship.

#### U-6 — High — Payment selection and form labels are inaccessible

The payment radios use `className="hidden"` (`src/pages/checkout/CheckoutPayment.tsx:60-66`). `display: none` removes them from the tab order, so a keyboard user cannot select a payment method. The label wrapper is clickable for a mouse, but the control itself is unreachable.

The checkout `Field` component renders a `<label>` with no `htmlFor` (`CheckoutShipping.tsx:28-47`), and the inputs have no `id` or `aria-describedby`. A screen reader announces unlabeled inputs, and clicking the label does not focus the field. The Track Order page uses placeholders as the only label (`src/pages/TrackOrder.tsx:111-129`).

#### U-7 — High — The cookie banner is misleading and “Decline” does not stop tracking

The banner says:

> “We do not use third-party tracking cookies.” (`src/components/CookieConsent.tsx:42`)

The privacy policy says the opposite: Google Analytics advertising features and remarketing (`src/pages/PrivacyPolicy.tsx:68-74`). `StoreAnalytics` injects GA whenever an ID is configured (`src/components/analytics/StoreAnalytics.tsx:13-36`) and never reads the consent key. Clicking “Decline” writes `accepted: false` (`CookieConsent.tsx:26-29`) but changes nothing about GA.

The banner is a fixed `div`, not a dialog, appears after two seconds (`CookieConsent.tsx:12-19,34`), and has no focus management or preference center. Consent is not informed, decline is meaningless, and the site’s own privacy policy contradicts the banner.

#### U-8 — High — The shipping and tax promises do not match checkout or the terms

The sitewide top bar says “Free shipping above $100” (`src/locales/en.json:15-16`; rendered at `src/components/layout/Navbar.tsx:192`). The default shipping zones charge $50-$220 with free thresholds of $2,000-$10,000 (`src/pages/admin/settings/types.ts:79-84`). Zone rules are authoritative and override the global threshold (`backend/src/utils/shipping.ts:120-126`). A customer can see “free over $100” on the home page, then be charged $50 at checkout.

The tax label is a static string, “Tax (8%)” (`src/locales/en.json:402`), even if the admin changes the rate. The terms say 18% GST for domestic buyers and $15 freight under $100 (`src/pages/TermsOfService.tsx:152,200`). The server defaults are 8% and $25 (`backend/src/services/settingsService.ts:44-52`). These cannot all be true for the same cart.

#### U-9 — High — Currency is hardcoded to USD in the transaction path

Order creation writes `currency: 'USD'` (`backend/src/services/orderMutations.ts:110`). The review and success pages print `$` (`src/pages/checkout/CheckoutReview.tsx:90-109`; `CheckoutSuccess.tsx:108-117`). Product cards print `$` (`src/components/ui/ProductCard.tsx:193-201`). PayPal is initialized with `currency: 'USD'` (`src/components/PayPalProvider.tsx:89`). Email templates also print `$` (`backend/src/services/emailTemplates.ts:79,92-95`).

Yet products have a currency field, and the admin can choose EUR, GBP, AED, INR, SGD, or JPY (`src/components/admin/ProductFormPricing.tsx:59-64`). The site also has a currency setting (`src/pages/admin/settings/types.ts:70`). If any non-USD product exists, the store charges the numeric amount in USD. That is a direct pricing error, not a display issue.

#### U-10 — Medium — L/C is advertised but collapsed into bank transfer

The default payment methods include Letter of Credit (`src/pages/admin/settings/types.ts:90`). The checkout maps both `bank` and `lc` to a single `'bank-transfer'` option (`src/pages/Checkout.tsx:200-201`). The payment step only lists bank transfer and PayPal (`CheckoutPayment.tsx:43-46`). A B2B buyer who needs an L/C gets a generic bank-transfer selection and no document instructions.

#### U-11 — Medium — Guest email is put in the URL

`CheckoutSuccess.tsx:170-172` navigates to:

```text
/track-order?id=<order>&email=<customer-email>
```

That puts the email in browser history, server access logs, and any analytics page location. It is convenient but unnecessary. Use a short-lived token, or a POST body.

#### U-12 — Medium — Mobile overlays collide

The sticky add-to-cart bar is `z-50` (`src/pages/ProductDetail.tsx:646`). The WhatsApp float is `z-[45]` (`src/components/WhatsAppFloat.tsx:16`). The cookie banner is `z-[200]` (`src/components/CookieConsent.tsx:34`). The cart drawer is `z-[60]` (`src/components/cart/CartDrawer.tsx:107`).

On a product page, the CTA can cover the WhatsApp button. The cookie banner covers both. The highest-value mobile actions compete for the same corner.

#### U-13 — Medium — RTL is only half-implemented

`document.documentElement.dir = 'rtl'` is set for Arabic (`src/App.tsx:100-101`), but the cart drawer remains `right-0` with `border-l` (`src/components/cart/CartDrawer.tsx:107`). Physical utilities (`left`, `right`, `ml`, `mr`, `translate-x`) do not mirror automatically. Arabic users get flipped text direction inside a left-to-right layout.

#### U-14 — Medium — Trust content contradicts the catalog and the terms

The testimonials are eBay feedback for pipe vises, threaders, and tubing benders, not marine parts (`src/data/testimonials.ts:3-66`). The FAQ says “We only supply OEM and authorized distributor stock” and provides certificates with every shipment (`testimonials.ts:96`). The terms say “We are dealing in old and used items — there will be no warranty” (`src/pages/TermsOfService.tsx:79`). The tagline says “Used & Unbranded Marine Equipment” (`src/pages/admin/settings/types.ts:63`).

A procurement officer will notice. Either narrow the claims or explain the condition categories and what documentation actually accompanies each grade.

#### U-15 — Medium — “48-hour dispatch guarantee” is an unqualified promise

`src/locales/en.json:18` promises a 48-hour dispatch guarantee. The terms describe Monday-Friday shipping and variable international freight (`TermsOfService.tsx:60`). If operations cannot meet it on every order, it is a refund and chargeback magnet.

#### U-16 — High — Refreshing the success page loses the order confirmation

Checkout state is in memory only. `orderId`, `orderSummary`, and `orderSkippedItems` are initialized but never saved to storage (`src/store/useStore.ts:531-545`). After the order succeeds, the cart is cleared and `orderPlaced` is true. On refresh, `orderPlaced` resets to false, the cart is empty, and the checkout redirects to `/products` (`src/pages/Checkout.tsx:167-173`). The customer loses the order number, totals, skipped-item list, and the visual confirmation.

This is especially bad for bank transfer, where the customer may refresh while waiting for instructions that never arrive.

**What this means for the visitor:** they can stay and read because the site looks specialized. They leave at checkout because the final screen says it is a demo, the default payment method cannot be completed, the form excludes their business details, and the confirmation disappears on refresh.

---

### 5.2 Developer

The backend has good instincts: server-authoritative pricing, atomic stock helpers, webhook signature checks, Zod validation, audit logs. The problems are duplication, missing test enforcement, and business rules that exist in three places.

#### D-0 — Critical — The working tree is not reproducible; a build-critical module is untracked

`shared/product-page.mjs` is a 65,467-byte module imported by:

- `server.js:23`
- `scripts/prerender.mjs:28`
- `src/lib/seo/productSeo.ts:19,24`

It is not tracked by git. Neither are its type declarations:

- `shared/product-page.d.ts`
- `shared/product-page.d.mts`

`tsconfig.app.json` includes `shared` in the TypeScript program. On a clean clone or CI runner, the file is missing, so the server cannot start, prerender cannot run, and TypeScript cannot resolve the import.

This is a release blocker. Commit the module and declarations, or move the engine into a tracked package. Add a clean-clone CI job that proves `npm ci`, build, and server start work from git alone.

#### D-1 — High — Two frontend servers, two deployment stories

The root `server.js` is 1,161 lines and is the Railway-facing entry (`package.json` `"start": "node server.js"`; `server.js:1144-1147`). `frontend/server.js` is 284 lines and is wired to a separate `frontend/package.json` with `"start": "node server.js"`.

They differ materially:

- Root uses Express 5; `frontend/package.json` uses Express 4.
- Root serves prerendered English files and proxies the sitemap.
- `frontend/server.js` contains its own build-recovery behavior.
- CSP, caching, and SEO behavior are implemented separately.

Unless one is formally retired, fixes can land in the wrong server. This is an operational landmine: a security header or canonical fix applied to one file will not reach the other. Decide which server is production, delete or archive the other, and make the deployment path explicit.

#### D-2 — High — Tests exist but never run in CI

There are six backend test files:

- `backend/src/utils/shipping.test.ts`
- `backend/src/utils/json.test.ts`
- `backend/src/utils/offerRules.test.ts`
- `backend/src/utils/offerAnalytics.test.ts`
- `backend/src/services/ebayOrderService.test.ts`
- `backend/src/services/ebayCatalogMapping.test.ts`

`backend/package.json:6-18` has no `test` script. CI only typechecks and builds (`.github/workflows/ci.yml:13-65`). Playwright specs exist (`e2e/product-image-adapter.spec.ts`, `e2e/admin-product-flow.spec.ts`) and root scripts expose them (`package.json:20-21`), but CI never runs them.

The tests that would catch shipping-threshold, offer-rule, and order-math regressions are never executed.

#### D-3 — High — Root typecheck is non-blocking in deploy

`.github/workflows/deploy.yml:64-69` runs `npx tsc -b --noEmit` with `continue-on-error: true`. CI runs a frontend typecheck (`.github/workflows/ci.yml:28-29`), but deploy deliberately ignores failure. A type regression can ship. Make the deploy typecheck blocking, or remove it and rely on CI; do not keep a green check that cannot fail.

#### D-4 — High/Critical (latent) — Multi-currency is modeled but not implemented in the order pipeline

Products have a `currency` field, and the admin can choose seven currencies (`src/components/admin/ProductFormPricing.tsx:59-64`). `createOrder` sums raw `getEffectivePrice` values (`backend/src/services/orderMutations.ts:83-88`) and writes `currency: 'USD'` (`:110`). `computeOrderTotals` does no conversion (`backend/src/services/orderPricing.ts:36-54`). The UI and emails print `$`.

If every product is USD today, this is latent. If any non-USD product is published, it is a direct financial bug. Normalize all prices to one store currency at the boundary, or reject products whose currency differs from the store currency, and add a test that asserts the charged currency and amount.

#### D-5 — High — Pricing rules are duplicated across server, client, and legal copy

There is no single source of truth:

- Server defaults: `backend/src/services/settingsService.ts:44-52`
- Client estimate: `src/pages/Checkout.tsx:180-188`
- Terms: `src/pages/TermsOfService.tsx:152,200`
- Top bar: `src/locales/en.json:15-16`
- Zone defaults: `src/pages/admin/settings/types.ts:79-84`

The server is authoritative for the charge, but the customer sees a different promise. Add a pricing contract test: for representative countries and carts, the displayed estimate must equal `computeOrderTotals` and the static copy must not contradict it.

#### D-6 — High — Admin authorization is enforced inconsistently

Mutation routes use `requireRole`, but many read routes only use `authenticateAdmin`:

- `backend/src/routes/admin/orders.ts:9,22,36`
- `backend/src/routes/admin/rfqs.ts:9,42,61`
- `backend/src/routes/admin/settings.ts:9,16`
- `backend/src/routes/admin/offers.ts:9,14,41`
- `backend/src/routes/admin/messages.ts:9,26,37`

The role hierarchy defines `viewer` as level 1 (`backend/src/middleware/auth.ts:93-100`), but read routes never set a minimum. A read-only account can enumerate PII. This is a design flaw, not a one-line bug: define a read policy per resource and redact fields the role does not need.

#### D-7 — Medium — Idempotency is stored in a free-text notes field

`orderMutations.ts:40-49` searches `customerNotes: { contains: '[idem:key]' }` within five minutes. It works for the happy path, but it couples dedupe to customer-visible notes, uses a non-unique `contains`, and depends on a time window. Add a dedicated `idempotencyKey` column with a unique constraint scoped to the customer or session.

#### D-8 — Medium — SEO metadata lives in three places

Runtime fallback metadata is in `server.js:52-53` and `STATIC_PAGE_META`. Build-time metadata is in `scripts/prerender-routes.mjs` and `scripts/prerender.mjs`. React metadata is in `src/components/seo/SEO.tsx`. These are three independent copies. A title change in one layer can leave the prerendered HTML and the hydrated page disagreeing. Consolidate into one route manifest consumed by all three.

#### D-9 — Medium — Frontend serving layer lacks compression and explicit asset caching

The root server sets CSP but does not use `compression()` and calls `express.static(distPath, { index: false, redirect: false })` (`server.js:1071`) with default cache behavior. The backend does use `compression()` (`backend/src/server.ts:228`). Vite emits hashed assets that can be cached immutably, but the server does not set that. First load and repeat visits depend on Railway/proxy behavior rather than an explicit policy.

Separately, `public/hero.mp4` is 52.8 MB and is copied to `frontend/dist/hero.mp4`, even though no source file references it. It is dead deploy weight, not a runtime request.

#### D-10 — Medium — Analytics has no SPA pageview or ecommerce instrumentation

`StoreAnalytics.tsx:13-36` configures GA once. There is no `gtag('event', 'page_view')` on route change, and no add-to-cart, begin-checkout, or purchase events were found. GA4 enhanced measurement may catch history changes if it is enabled in the property, but the code does not guarantee it. The client cannot reliably see the funnel or attribute revenue.

#### D-11 — Medium — CI Node version is below the declared engine

CI uses Node 20 (`.github/workflows/ci.yml:23,51`). The root package requires Node >=22 (`package.json:7`). Builds can pass on 20 while production runs 22, or vice versa. Pin the same version everywhere.

#### D-12 — Medium — Order creation is not one transaction

`orderMutations.ts:106-139` creates the order, then items in a loop, then the timeline. On failure it deletes the order. Audit logging and notifications happen afterward. A crash mid-loop can leave partial state depending on foreign-key/cascade behavior. Use a Prisma transaction for order, items, and timeline.

#### D-13 — Low — Settings updates are an untyped key/value blob

`backend/src/routes/admin/settings.ts:11-13` accepts any record of string/number/boolean/null. `settingsService.updateSettings` upserts arbitrary keys (`settingsService.ts:84-95`). Typos are silent, and an admin can write keys the storefront never reads. A per-key schema would prevent the “configured bank details are ignored” class of bug.

#### D-14 — Low — Comments and code drift is a maintenance signal

The checkout comment says skipped lines are recorded “for admin visibility” (`orderMutations.ts:62-67`); the timeline note does record them (`:127-135`), but the customer only sees them after the order. Several “P0/P1” comments describe fixes that are incomplete (CSRF skip, token type). Treat comments as stale until the comment pass; add tests for behavior instead.

---

### 5.3 SEO Specialist

Technically, the English SEO layer is better than most SPA builds: canonical host, trailing slashes, private-page noindex, prerendered routes, sitemap merge, JSON-LD. Strategically, the multilingual layer is switched off.

#### S-1 — Critical (SEO) — Arabic and Spanish are served but explicitly de-indexed

Every layer agrees:

- `X-Robots-Tag: noindex, follow` for `/ar` and `/es` (`server.js:490`)
- React emits `<meta name="robots" content="noindex, follow">` for any non-English locale (`src/components/seo/SEO.tsx:266`)
- Runtime fallback sets `noindex` for `!translated` (`server.js:1112-1113`)
- Prerender only includes `en` (`scripts/prerender-routes.mjs:17`)
- Hreflang generators return nothing (`scripts/prerender.mjs:80-83`; `SEO.tsx:37-40`)
- Sitemap only emits `/en/...` (`backend/src/services/sitemapService.ts:71-78`)

The UI still offers AR and ES in the language switcher (`src/components/layout/Navbar.tsx:27-28`). Users can read translated pages, but Google is told not to index them, and there is no alternate relationship.

If AR/ES are real markets, this is a critical acquisition blocker. If they are not ready, remove them from the switcher and sitemap until they are. Do not ship a half-indexed language layer.

#### S-2 — High — Product structured data claims free returns; the refund policy says otherwise

Both product JSON-LD paths set:

```js
returnFees: 'https://schema.org/FreeReturn'
```

Evidence: `shared/product-page.mjs:1363-1370` (prerendered and SPA product model) and `src/components/seo/SEO.tsx:237-245` (SPA fallback generator). The visible badge says “30-Day Returns” (`src/pages/ProductDetail.tsx:471`). The policy says the buyer pays return shipping, damaged items are not returnable, and acceptance is at the seller’s sole discretion (`src/pages/RefundPolicy.tsx:33-39`).

This is a mismatch between rich-result markup and the actual policy. Google’s structured-data policies require accuracy; at minimum the rich result can be suppressed, and repeated mismatches can trigger manual action. It is also a consumer-protection problem. Fix the schema to match the policy, or change the policy to match the promise.

The schema also sets `applicableCountry: 'IN'` while the store ships globally. If the visible promise is global, that is another mismatch.

#### S-3 — Medium — Product availability can default to “InStock” when unknown

`SEO.tsx:232` falls back to `https://schema.org/InStock` when `productAvailability` is missing. The main product path always supplies it (`src/lib/seo/productSeo.ts:79-81`), so this is a latent fallback for other callers. Defaulting to in-stock is the wrong failure mode: use `OutOfStock` or omit the offer until availability is known.

#### S-4 — Medium — Static metadata is duplicated, so SEO changes can drift

The same route can be described by `server.js:52-53`, `scripts/prerender-routes.mjs`, `scripts/prerender.mjs`, and `SEO.tsx`. A title/description change in one layer can leave the prerendered HTML and the hydrated page disagreeing. Consolidate.

#### S-5 — Medium — Product JSON-LD has two generators

`shared/product-page.mjs` generates the product schema used by the prerenderer and the SPA product model. `SEO.tsx:206-245` contains a fallback product-schema generator. The SPA guards against emitting both when a supplied `Product` schema exists (`SEO.tsx:206-211`), which is good. But the policy values are duplicated in both generators, so a change to the return policy or condition rules must be mirrored. The current free-return mismatch exists in both places.

Add a golden-file test that compares the JSON-LD emitted by the prerenderer and the SPA for the same product.

#### S-6 — Medium — No article/guide route layer

The route list is commercial: products, brands, categories, industries, about, RFQ, legal (`src/App.tsx:131-157`). `Intelligence` is a static insight index, not an article system. For long-tail queries like “how to identify a marine pump impeller” or “Alang spare parts procurement,” there is no page to rank. This is a strategy gap, not a code bug. If the client wants organic acquisition beyond product SKUs, add a small, genuinely useful technical content hub.

#### S-7 — Good — Canonicalization and crawl policy

- Host canonicalization: `server.js:459-469`
- Duplicate slashes and locale case: `server.js:474-483`
- Trailing slash policy: `server.js:1106-1110`
- Private pages noindex: `server.js:489-493`
- Sitemap caching and fallback: `server.js:1030-1042`
- Non-HTML asset requests do not get the SPA shell: `server.js:1090-1094`

These are solid. Preserve them when fixing the multilingual layer.

---

### 5.4 Client / Business Owner

The site can attract the right visitor. It cannot yet convert or fulfil the order without manual heroics.

#### C-1 — Critical — The checkout cannot reliably take money

Three failures combine:

1. The review step says it is a demo (`src/locales/en.json:410`).
2. Bank transfer is the default, but no bank details are shown or emailed (`src/pages/Checkout.tsx:42`; `en.json:398`; `backend/src/services/orderMutations.ts:152-159,488-502`).
3. No customer confirmation is sent at order placement (`orderMutations.ts:152-159`).

Every paid click that reaches checkout is exposed to abandonment. Bank-transfer customers cannot pay without an out-of-band email that the code never sends. This is not a conversion optimization issue; it is a broken payment path.

#### C-2 — Critical — The money math is not consistent enough to invoice safely

The site simultaneously promises:

- “Free shipping above $100” (`en.json:15-16`) and zone rates of $50-$220 with $2,000-$10,000 free thresholds (`src/pages/admin/settings/types.ts:79-84`)
- “Tax (8%)” (`en.json:402`) and 18% GST domestic (`src/pages/TermsOfService.tsx:200`)
- $25 default freight (`backend/src/services/settingsService.ts:46`) and $15 under $100 (`TermsOfService.tsx:152`)
- USD everywhere in the transaction path (`orderMutations.ts:110`) and per-product currencies (`ProductFormPricing.tsx:59-64`)
- “30-Day Returns” (`ProductDetail.tsx:471`) and buyer-paid return shipping with damaged items excluded (`RefundPolicy.tsx:33-39`)

This is a pricing-contract problem, not a copy tweak. It creates under/overcharging, GST invoice mismatches, refund disputes, and margin leakage. Pick one source of truth, make checkout and terms consume it, and test it.

#### C-3 — Critical — Payment and stock can diverge

PayPal capture happens before stock is decremented (`backend/src/services/paypalService.ts:404-506`). The code checks stock before capture, but another order can take the last unit in the race window. If the decrement then fails, the order is reverted to pending after the money has been captured (`:487-505`), and there is no automatic refund in that path. The customer has paid and does not have a confirmed order.

Bank transfer decrements stock only when an admin marks the order paid (`orderMutations.ts:237-271`). Until then, the last unit can be sold twice. If the decrement fails after the bank payment, the admin has to refund manually.

This is a stop-ship operational risk: paid customers without orders, oversells, manual refunds, and chargebacks.

#### C-4 — High — The B2B procurement workflow is incomplete

- L/C is collapsed into bank transfer (`Checkout.tsx:200-201`).
- The checkout collects no phone, company, or VAT/tax ID (`CheckoutShipping.tsx:5-14`).
- The order schema cannot store them (`backend/prisma/schema.prisma:332-364`).
- Shipping is a flat zone rate, not a quote for heavy marine equipment.
- There is no proforma invoice, packing list, or freight-quote flow in checkout.

The site talks to shipowners, fleet managers, and shipyards, but the checkout is a consumer cart. The highest-value buyers will abandon or email instead.

#### C-5 — High — Brand proof is contradictory

- The default admin settings use a UAE phone number, `Asia/Dubai`, and Emirates NBD/Alka Traders LLC bank details for an Indian company (`src/pages/admin/settings/types.ts:65,71,89`).
- Testimonials are eBay feedback for pipe tools and threaders (`src/data/testimonials.ts:3-66`).
- The FAQ claims OEM/authorized stock and certificates with every shipment (`testimonials.ts:96`).
- The terms say used items have no warranty (`TermsOfService.tsx:79`).
- The tagline says “Used & Unbranded Marine Equipment” (`settings/types.ts:63`).

A procurement officer doing due diligence will notice. Replace the placeholders with real company details, add marine-specific references, and align the OEM/certificate claims with the actual condition grades.

#### C-6 — High — Customers are left in the dark after ordering

Bank-transfer customers get no confirmation at placement (`orderMutations.ts:152-159`). The success page promises one “shortly” (`en.json:412`). The confirmation is sent only when an admin marks the order paid (`orderMutations.ts:286-288`). Refreshing the success page loses the order number and totals (`src/store/useStore.ts:531-545`; `Checkout.tsx:167-173`). Tracking requires order number plus email, and the email is passed in the URL (`CheckoutSuccess.tsx:170-172`).

The customer experience is: “Order placed. You’ll hear from us. Maybe.” That is a support burden and a trust failure.

#### C-7 — High — SEO investment in AR/ES is wasted

The site offers Arabic and Spanish, but every layer tells Google not to index them (`server.js:490`; `SEO.tsx:266`; `prerender-routes.mjs:17`; `sitemapService.ts:71-78`). If the client is paying for translation and localized content, that spend has no acquisition return. Either finish and index the languages, or remove them from the switcher until they are ready.

#### C-8 — Medium — Analytics cannot answer “where did the money go?”

GA loads without consent gating (`StoreAnalytics.tsx:13-36`), there are no SPA pageviews, and there are no ecommerce events. The client cannot see checkout drop-off, attribute RFQs/orders, or measure whether the fixes worked. Fix consent and instrument the funnel before spending on ads.

#### C-9 — Medium — Support surfaces compete with checkout on mobile

The WhatsApp button is covered by the add-to-cart bar on product pages (`ProductDetail.tsx:646`; `WhatsAppFloat.tsx:16`). WhatsApp is the channel the business actually uses for emergency RFQs. Hiding it on the highest-intent mobile page is a revenue leak, not just a layout issue.

#### C-10 — Medium — Maintenance and deploy risk

Two frontend servers (D-1), an untracked build-critical module (D-0), no CI tests (D-2), and a non-blocking typecheck (D-3) mean the client is one regression away from a checkout outage. The lack of tests around shipping thresholds and offer rules is especially risky because those rules are already inconsistent.

#### C-11 — Medium — Dead 52.8 MB asset

`public/hero.mp4` is copied into `frontend/dist/hero.mp4` but is not referenced by the source. It adds deploy and storage weight with no runtime benefit. Remove it.

#### C-12 — Good — The niche and the top of funnel

A visitor looking for a specific marine part has a reason to stay: the catalog is organized by system (engine, pumps, electrical, hydraulic), the RFQ path accepts part numbers and nameplate photos (`src/pages/Home.tsx:118`), the Bhavnagar address is real (`src/data/testimonials.ts:68-77`), and the offer/RFQ workflow is a genuine differentiator. The problem is the last mile.

---

### 5.5 Security Expert

The security baseline is better than the average SMB storefront: bcrypt cost 12, httpOnly/SameSite=strict refresh cookies, rate-limited auth, Zod validation, PayPal webhook verification, audit logs, CSP nonces. The gaps are authorization granularity, token lifecycle, and secret-bearing URLs.

#### X-1 — High — Refresh tokens are accepted as access tokens

`authenticateAdmin` verifies the JWT and only rejects `type === 'customer'` (`backend/src/middleware/auth.ts:31-38`). `authenticateCustomer` only checks `type === 'customer'` (`:55-59`). Neither rejects `decoded.refresh`.

Refresh tokens are signed with `refresh: true` (`backend/src/services/authService.ts:35-38`). Customer refresh tokens last 14 days (`:63,100,146`); admin refresh tokens last 7 days (`:223,256-258`). A stolen refresh token can be used directly as a bearer token, bypassing the intended token-type separation and extending the usable window.

This is conditional on token theft, but it is a real control failure. Reject `refresh` in both access middleware and keep refresh tokens on the refresh endpoint only.

#### X-2 — High — No revocation or session version; long-lived access tokens

Customer access tokens last 7 days (`authService.ts:31-33`). Admin access tokens use `JWT_EXPIRES_IN`, default 15 minutes (`:26-28`). There is no `tokenVersion`, `passwordChangedAt`, or session table in `schema.prisma` (verified by search).

`authenticateCustomer` does not check customer status per request (`auth.ts:47-65`). Status is checked only at refresh (`authService.ts:137-141`). Logout requires a valid access token (`backend/src/routes/storefront/auth.ts:68`), so an expired session cannot clear its refresh cookie.

A stolen customer token remains valid after logout or deactivation until expiry. A stolen admin refresh token can mint new access for 7 days (`authService.ts:242-258`). Add a token version/session ID, bump it on password change/logout/deactivation, and check status per request (or use short access TTLs with rotation).

#### X-3 — High — `viewer` can read customer PII and all store settings

These routes apply only `authenticateAdmin`:

- Orders list/detail: `backend/src/routes/admin/orders.ts:9,22,36`
- RFQ list/detail: `backend/src/routes/admin/rfqs.ts:9,42,61`
- All settings: `backend/src/routes/admin/settings.ts:9,16`
- Offers: `backend/src/routes/admin/offers.ts:9,14,41`
- Messages: `backend/src/routes/admin/messages.ts:9,26,37`

The role hierarchy defines `viewer` as level 1 (`auth.ts:93-100`), but read routes never enforce a minimum. A read-only account can enumerate names, emails, addresses, order values, RFQ contacts, messages, and payment/bank configuration. `getAllSettings` returns every row (`backend/src/services/settingsService.ts:10-18`), with no redaction.

Fix: explicit read roles per resource, field-level redaction for PII, and audit read access for sensitive records.

#### X-4 — High — Password-reset tokens leak through URLs, logs, and analytics

The reset URL puts the JWT in the query string (`authService.ts:169`). The frontend logs every request URL including the query (`server.js:446-451`). `StoreAnalytics` is mounted above the route tree (`src/App.tsx:124`), and the reset route is inside it (`:148`). `ResetPassword.tsx:11` reads the token from `useSearchParams`.

With GA configured, `page_location` includes the token. With frontend logs, the token lands in Railway logs. The token is valid for one hour (`authService.ts:166`). Exchange the token for a short-lived httpOnly cookie on a POST, or at minimum strip it from the URL/history and exclude the reset route from analytics and URL logging.

#### X-5 — Medium — CSRF verification fails open when the cookie is absent

`backend/src/middleware/csrf.ts:125-128` returns `next()` if `!cookieToken`. Refresh endpoints are explicitly skipped (`:109-120`), and webhooks are skipped (`:93-97`).

Current state-changing authenticated routes mostly use bearer tokens, which are not sent automatically cross-site, so this is not a proven direct exploit. But it is a fail-open control: any future cookie-authenticated POST/PATCH is unprotected if the CSRF cookie is missing or cleared. Require the token for cookie-authenticated state-changing requests, or scope the middleware only to routes that use cookies.

#### X-6 — Medium — Email is case-sensitive, enabling duplicate accounts and offer-limit bypass

Registration, login, and reset use exact `findUnique({ email })` (`authService.ts:55,87,156`). Postgres unique indexes are case-sensitive by default (`schema.prisma:18,45`). Offer abuse limits count exact `customerEmail` (`backend/src/services/offerService.ts:72-73`).

`User@x.com` and `user@x.com` are different accounts. A user with a casing variant cannot log in or reset. An abuser can multiply offer limits by changing case. Normalize to lowercase at the boundary (or use `citext`) and add a case-insensitive unique index.

#### X-7 — Medium — Guest email is exposed in the Track Order URL

`CheckoutSuccess.tsx:170-172` puts the guest email in the query string. It lands in browser history, access logs, and analytics. The tracking endpoint itself uses a POST body (`backend/src/routes/storefront/orders.ts:66-70`), so the URL is only a convenience. Use a short-lived token or a POST.

#### X-8 — Medium — RFQ consent is hardcoded true

`src/components/sections/RFQSection.tsx:67` sends `consent: true`. The API expects a consent field (`src/lib/api/storefront.ts:75`). There is no checkbox or privacy-policy link in the form. Consent is not freely given. Add an explicit checkbox, store a timestamp and policy version, and link the policy.

#### X-9 — Medium — Frontend security headers are incomplete

`server.js:440-444` sets only CSP. There is no `Strict-Transport-Security`, `Referrer-Policy`, `X-Content-Type-Options`, or `Permissions-Policy` on the HTML origin. The backend uses helmet (`backend/src/server.ts:166-187`), but users visit the frontend origin. Add the missing headers at the edge or in `server.js`.

`style-src 'unsafe-inline'` (`server.js:419`) weakens CSP, though it is common with inline styles. Treat it as hardening, not a launch blocker.

#### X-10 — Low — Registration reveals whether an email exists

`authService.ts:55-56` returns “Email already registered.” Login is generic (`:88,91`), and forgot-password is generic (`:158-160`). Registration enumeration is low severity but unnecessary. Return a generic response and rely on email verification or rate limits.

#### X-11 — Good — Baseline controls to preserve

- bcrypt cost 12 (`authService.ts:58`)
- Refresh cookies `httpOnly`, `secure` in production, `sameSite: 'strict'` (`:41-48`)
- Rate limiters on login/register/reset (`backend/src/middleware/rateLimit.ts:14-31`; mounted at `backend/src/server.ts:371,403`)
- Zod validation on routes
- PayPal webhook signature verification (`backend/src/routes/webhooks/paypal.ts:16-23`)
- CSP nonce for JSON-LD (`server.js:440-444`)
- Access tokens kept in memory, not localStorage (`src/lib/api/core.ts:59`)
- Audit logs for admin mutations

These are real strengths. Fix the gaps without weakening them.

---

## 6. Why a visitor would stay, read, or buy

### Stay

The site immediately answers “do you have my part?” with a marine-specific taxonomy, part-number search, brand hubs, and an RFQ path (`src/pages/Home.tsx:27-30,118,135-138`). A visitor with a broken pump or a vessel deadline sees relevance in the first screen. The Bhavnagar address, WhatsApp channel, and Alang-market positioning are credible signals for a procurement officer (`src/data/testimonials.ts:68-77`). The visual system is coherent, and the product cards show brand, SKU, and condition — the things a technical buyer scans.

They leave when the cookie banner covers the page after two seconds, the mobile CTA covers the WhatsApp button, the payment radios cannot be reached by keyboard, and the checkout calls itself a demo.

### Read

Product pages have specs, condition notes, part numbers, related part numbers, and structured data (`src/pages/ProductDetail.tsx:191-203,342-351,605-612`). Category, brand, industry, and intelligence pages give context. That is the right content for a technical buyer.

But the FAQ claims OEM/authorized stock and certificates with every shipment (`src/data/testimonials.ts:96`), while the terms say used items have no warranty (`src/pages/TermsOfService.tsx:79`). A careful buyer will stop trusting the copy. The site also has no article/guide layer to capture informational queries; it can rank for SKUs, not for expertise.

### Buy

The buy decision needs four answers: exact price, shipping cost and date, payment safety, and what happens if the item is wrong. The site answers the first two partially, then breaks the last two.

- **Price:** visible, but currency and tax/shipping promises conflict.
- **Payment:** bank transfer is the default and unpayable; PayPal is the only working path, and it can capture before stock is secured.
- **Post-purchase:** no confirmation at placement, a success page that promises one, a blanket 5-7 day estimate, and a returns schema that says free while the policy says buyer-paid.

A visitor may stay and read because the niche and catalog are credible. They will not buy at scale until the transaction layer matches the trust layer.

**One-sentence answer:** they stay because the site looks like a specialist, they read because the product data is specific, and they do not buy because the checkout tells them it is a demo, cannot tell them how to pay by bank, and cannot confirm the order they just placed.

---

## 7. What is genuinely good

This is not a rebuild. The foundation has real strengths:

- **Server-side price authority.** The client never dictates line prices, shipping, or tax (`backend/src/services/orderMutations.ts:83-104`; `orderPricing.ts:23-54`).
- **Stock helpers with rollback.** Partial decrements are compensated (`orderMutations.ts:237-271`; `paypalService.ts:472-505`).
- **Payment verification.** PayPal capture amount is checked against the order total (`paypalService.ts:438-445`), and webhooks are signature-verified (`backend/src/routes/webhooks/paypal.ts:16-23`).
- **Auth baseline.** bcrypt 12, httpOnly/SameSite=strict refresh cookies, rate limits, generic login errors, in-memory access tokens (`authService.ts:41-58`; `src/lib/api/core.ts:59`).
- **Input validation.** Zod schemas on the important routes.
- **Canonicalization.** Host, duplicate slash, locale case, and trailing slash are handled (`server.js:459-483,1106-1110`).
- **Crawl policy.** Private pages are noindex, admin is noindex/nofollow, and non-HTML asset requests do not get the SPA shell (`server.js:489-493,1090-1094`).
- **SEO scaffolding.** Prerendered English routes, sitemap merge, JSON-LD, CSP nonce (`server.js:1030-1044`; `scripts/prerender.mjs`).
- **Admin audit trail.** Mutations are logged.
- **Niche clarity.** The marine taxonomy, RFQ flow, and Bhavnagar presence are real differentiators.
- **Product model.** `shared/product-page.mjs` provides a single product-page model for the prerenderer and the SPA, including a guard against duplicate Product JSON-LD (`SEO.tsx:206-211`).

Preserve these while fixing the commercial path.

---

## 8. Fix plan

This is the original plan, kept for reference. What has actually shipped is
recorded in **§15**; what is still open is listed in **§16**.

### 8.1 P0 — before taking money or buying traffic

1. **Remove the demo-checkout copy, or move the build to staging.**
   - Remove `checkout.secureFooter` demo language.
   - Add a production/staging environment check so demo copy cannot ship.
   - Acceptance: no “demo” or “no real charges” string in the production locale; a real test order completes.

2. **Make bank transfer payable, or disable it.**
   - Show bank name, account name, account number, IBAN, SWIFT, reference format, and amount on the success page.
   - Send the same details in the customer email at placement.
   - If operations cannot support this yet, disable bank transfer in the checkout.
   - Acceptance: a bank-transfer test order can be paid from the information the customer receives.

3. **Send a customer confirmation at order placement for every method.**
   - Guest and account orders.
   - Include order number, items, quantities, totals, shipping address, payment method, payment instructions, and support contact.
   - Align the success-page copy with the actual send time.
   - Acceptance: every test order produces exactly one customer confirmation at placement.

4. **Make capture, order state, and stock decrement atomic, with automatic refund on failure.**
   - Reserve stock before capture, or capture with an idempotent reservation.
   - If stock fails after capture, refund automatically and record the refund.
   - Never leave an order pending with captured money.
   - Acceptance: forced stock failure leaves money and order reconciled.

5. **Reconcile tax, shipping, currency, and returns.**
   - One server-side pricing contract.
   - Checkout, email, top bar, and terms read from it.
   - Normalize or reject non-store currencies.
   - Make the return schema match the refund policy.
   - Acceptance: test matrix for India, US, UK, UAE; below/above thresholds; USD/EUR product; the displayed estimate equals the server total and the terms do not contradict it.

6. **Add terms/privacy acceptance at checkout.**
   - Checkbox with links to terms, privacy, and refund policy.
   - Record acceptance time and version.
   - Acceptance: order cannot be placed without acceptance.

7. **Fix admin PII access and reset-token exposure.**
   - Explicit read roles per resource; `viewer` gets 403 on PII routes.
   - Redact fields the role does not need.
   - Reset token: POST exchange or httpOnly cookie; strip from URL/history; exclude reset route from analytics and URL logs.
   - Acceptance: viewer cannot read PII; reset token absent from logs and GA.

8. **Decide AR/ES.**
   - If live: prerender AR/ES, add hreflang, add sitemap entries, remove noindex.
   - If not live: remove AR/ES from the switcher and sitemap.
   - Acceptance: no language is offered to users while being noindexed.

9. **Fix checkout accessibility and B2B fields.**
   - Visible payment radios; keyboard operable.
   - `htmlFor`/`id`/`aria-describedby` on all fields.
   - Phone, company, VAT/tax ID fields and storage.
   - State/postal code optional where the country does not use them.
   - Acceptance: keyboard-only checkout passes; axe scan clean.

10. **Commit the shared product-page engine and types.**
    - `shared/product-page.mjs`
    - `shared/product-page.d.ts`
    - `shared/product-page.d.mts`
    - Acceptance: clean clone runs install, build, and server start.

### 8.2 P1 — before scaling marketing

- Customer confirmation and tracking without email in the URL.
- Consent-gated GA; SPA pageviews and ecommerce events.
- Backend tests and Playwright smoke tests in CI; blocking typecheck; Node 22 everywhere.
- One frontend server; retire the other start script.
- One pricing source of truth; one SEO route manifest.
- Real company details; marine-specific references; align OEM/certificate claims with actual condition grades.
- L/C/freight-quote workflow for B2B.
- Refresh-safe order confirmation.
- Real bank details or bank transfer disabled.
- Replace the static “Tax (8%)” and “Free shipping above $100” strings with settings-driven values.

### 8.3 P2 — hardening and polish

- Dedicated idempotency column; transactional order creation.
- Per-key settings schema.
- Token versioning/session revocation.
- Case-insensitive email.
- CSRF require-token for cookie auth.
- HSTS, Referrer-Policy, X-Content-Type-Options, Permissions-Policy.
- Compression and immutable asset caching.
- RTL mirroring.
- Mobile overlay layout.
- Remove dead 52.8 MB asset.
- Structured-data golden tests.
- Technical content hub.
- Dependency and supply-chain audit.
- Backup/restore and migration runbook.

---

## 9. Evidence index

| File | What it proves |
|---|---|
| `server.js` | Frontend runtime, CSP, canonicalization, noindex policy, URL logging, sitemap proxy, static serving |
| `frontend/server.js` | Second startable frontend server |
| `scripts/prerender-routes.mjs` | Prerender is English-only |
| `scripts/prerender.mjs` | Hreflang generator returns empty; product page generation |
| `src/components/seo/SEO.tsx` | AR/ES noindex, empty hreflang, fallback product schema |
| `shared/product-page.mjs` | Shared product page and JSON-LD, including free-return policy. Untracked |
| `backend/src/services/sitemapService.ts` | Sitemap is English-only |
| `backend/src/middleware/auth.ts` | Refresh tokens not rejected; role hierarchy |
| `backend/src/middleware/csrf.ts` | CSRF fails open when cookie absent |
| `backend/src/services/authService.ts` | Token lifetimes, case-sensitive email, reset URL |
| `backend/src/routes/admin/orders.ts` | Viewer-readable order PII |
| `backend/src/routes/admin/rfqs.ts` | Viewer-readable RFQ PII |
| `backend/src/routes/admin/settings.ts` | Viewer-readable all settings |
| `backend/src/routes/admin/offers.ts` | Viewer-readable offers |
| `backend/src/routes/admin/messages.ts` | Viewer-readable messages |
| `backend/src/services/orderMutations.ts` | Skipped lines, no customer email, stock on paid, USD hardcode |
| `backend/src/services/paypalService.ts` | Capture before stock; revert after payment |
| `backend/src/services/orderPricing.ts` | Server-authoritative totals |
| `backend/src/utils/shipping.ts` | Zone rules override global free-shipping threshold |
| `src/pages/Checkout.tsx` | Default bank transfer, validation, cart clearing, payment fallback |
| `src/pages/checkout/CheckoutPayment.tsx` | Hidden payment radios |
| `src/pages/checkout/CheckoutSuccess.tsx` | Email/5-7 day promises, URL email, refresh loss |
| `src/components/CookieConsent.tsx` | Misleading consent banner |
| `src/components/analytics/StoreAnalytics.tsx` | GA loads without consent |
| `src/pages/RefundPolicy.tsx` | Buyer-paid returns, damaged items excluded |
| `src/pages/TermsOfService.tsx` | Shipping, GST, and warranty terms |
| `src/data/testimonials.ts` | eBay pipe-tool testimonials; OEM/certificate claims |
| `src/pages/admin/settings/types.ts` | UAE defaults, shipping zones, L/C, currency |
| `src/store/useStore.ts` | Order state is not persisted |
| `backend/prisma/schema.prisma` | No phone/company/VAT; case-sensitive email; no token version |
| `.github/workflows/ci.yml` | Build only; Node 20; no tests |
| `.github/workflows/deploy.yml` | Non-blocking root typecheck |
| `backend/package.json` | No test script |
| `public/hero.mp4` | 52.8 MB unused asset copied into build |

---

## 10. Test inventory and coverage gaps

### Existing backend tests

| Test | Likely coverage |
|---|---|
| `backend/src/utils/shipping.test.ts` | Zone authority, free threshold, fallback |
| `backend/src/utils/json.test.ts` | JSON parsing/formatting |
| `backend/src/utils/offerRules.test.ts` | Offer eligibility and limits |
| `backend/src/utils/offerAnalytics.test.ts` | Offer analytics |
| `backend/src/services/ebayOrderService.test.ts` | eBay order mapping |
| `backend/src/services/ebayCatalogMapping.test.ts` | eBay catalog mapping |

### Existing end-to-end specs

- `e2e/product-image-adapter.spec.ts`
- `e2e/admin-product-flow.spec.ts`

### Missing coverage

- Checkout order creation, guest and account.
- Bank transfer payment instructions.
- PayPal capture, stock failure, refund.
- Admin RBAC and PII redaction.
- Auth refresh/token type.
- Password reset flow.
- Consent gating.
- SEO JSON-LD and hreflang.
- Accessibility (axe/keyboard).
- Mobile overlay layout.
- Sitemap and canonicalization.

### CI gaps

- No backend test command.
- No Playwright run.
- No clean-clone build check.
- No accessibility scan.
- No dependency audit.
- Node version mismatch with `engines`.

---

## 11. Data model and API notes

### Order model

`backend/prisma/schema.prisma:332-364`:

- `currency` defaults to `USD`; the application hardcodes USD on creation.
- No `shippingPhone`, `shippingCompany`, or `shippingTaxId`.
- Guest contact is `shippingEmail`; account orders rely on `Customer.email`.
- Status and payment status are separate strings.
- No idempotency key column; dedupe uses `customerNotes`.

### Customer model

- `email` is `@unique` but case-sensitive by default (`schema.prisma:45`).
- `phone`, `company`, `country` exist.
- No token version or session table.

### Admin user model

- No token version or session table.
- Role is a string; hierarchy is enforced in middleware.
- Read routes lack role thresholds.

### Settings model

- Key/value blob.
- `getAllSettings` returns every row.
- `getPublicSettings` exposes a curated list.
- Checkout does not read the configured bank details.

### API behavior worth preserving

- Server-side price calculation.
- PayPal amount verification.
- Webhook signature verification.
- Zod request validation.
- Audit logging on mutations.
- Rate limiting on auth endpoints.
- httpOnly refresh cookies.

---

## 12. Open questions

These need answers from the client/operator before some fixes can be finalized:

1. **Which frontend server is live?** Root `server.js`, `frontend/server.js`, or both on different hosts?
2. **Is the working tree the release, or is HEAD the release?** If HEAD, the missing `shared/product-page.mjs` will break the build.
3. **Are any non-USD products published?** If yes, U-9/D-4 is an active financial bug.
4. **Are shipping zones configured in production?** If yes, the “free over $100” top bar is false.
5. **Is bank transfer handled manually outside the code?** If yes, document and automate it; if no, disable it.
6. **Are AR/ES intended markets?** If yes, finish and index; if no, remove them from the switcher.
7. **Is GA configured in production?** If yes, the consent and reset-token leaks are active.
8. **Is PayPal live or sandbox?** The demo copy and payment behavior depend on it.
9. **Are the UAE defaults placeholders or copied into production settings?**
10. **Who uses the `viewer` role, and should it see PII at all?**

---

## 13. Appendix: route and workflow map

### Storefront routes

- `/` — home
- `/:locale/products` — catalog
- `/:locale/product/:key` — product detail
- `/:locale/brands`, `/:locale/brands/:slug` — brand hubs
- `/:locale/categories/:slug` — category hub
- `/:locale/industries` — industries
- `/:locale/rfq` — request for quote
- `/:locale/contact` — contact
- `/:locale/search` — search
- `/:locale/emergency` — emergency procurement
- `/:locale/network` — network
- `/:locale/intelligence` — insight index
- `/:locale/checkout` — checkout
- `/:locale/track-order` — guest/account tracking
- `/:locale/account/orders` — order history
- `/:locale/account/offers` — offers
- `/:locale/account/offers/:id/pay` — offer payment
- `/:locale/account/profile` — profile
- `/:locale/privacy-policy`, `/:locale/terms-of-service`, `/:locale/refund-policy` — legal

### Admin routes

- `/admin` — admin app
- Admin auth: login, refresh, logout, me
- Admin orders: list, detail, status, tracking
- Admin RFQs: list, detail, status, notes, response, convert
- Admin offers: list, analytics, detail, counter
- Admin messages: list, detail, compose, reply, star
- Admin settings: get all, update
- Admin products, inventory, eBay, customers, reports

### Key workflows

1. **Catalog to RFQ:** search/browse → product or RFQ form → admin review → quote/offer.
2. **Catalog to order:** cart → checkout → order → payment → confirmation → fulfilment.
3. **Offer to order:** offer submitted → admin counter/accept → customer pays → order.
4. **Guest tracking:** order number + email → status.
5. **Admin fulfilment:** order paid → stock decrement → pick/pack → tracking → shipped email.
6. **Cancellation/refund:** customer request → admin cancel → stock restore + PayPal refund if applicable.

---

## 14. Final note

This document began as a read-only audit and is now the working tracker for the fixes. §15 records every applied change.

All ten P0 launch gates are closed (batches 1–5). The work after that is P1/P2 hardening; batches 6 onwards close the remaining code-scoped items, and **§16** tracks what is still open, including the items that need a human (real company details, marine references).

---

## 15. Fix log

Each entry lists the finding, the files changed, and how it was verified.

### Batch 1 — build reproducibility, honest checkout copy, payable bank transfer

**D-0 — build-critical module is now tracked**

- `git add shared/product-page.mjs shared/product-page.d.ts shared/product-page.d.mts`
- The shared product-page/JSON-LD engine and both type declarations are now in the index, so a clean clone can build, prerender, and start the server.
- Verified: `npx tsc -b --noEmit` and `npm run build` both succeed from the tracked tree.

**U-1 / C-1 — the checkout no longer calls itself a demo**

- `src/locales/en.json`, `src/locales/es.json`, `src/locales/ar.json`
  - `checkout.secureFooter` → “Your payment information is secure. We never store your card or bank credentials.”
  - `dashboard.sub` → “Live procurement overview” (was “Demo — Client Portal Preview”).
- No `demo` / `no real charges` string remains in any shipped locale.

**U-2 / C-1 / Gate 2 — bank transfer is now payable**

- New `backend/src/services/bankDetailsService.ts`
  - Resolves bank instructions from the admin's `store.paymentMethods` bank method `config`, with a `checkout.bankDetails` override.
  - Strips placeholder values (`XXXX-XXXX-XXXX-1234`, `TODO`, …) so a placeholder can never reach a customer as a real account.
  - `isBankTransferPayable()` requires an account number **and** account name.
  - `buildPaymentReference()` derives the payment reference from the order number.
- `backend/src/services/settingsService.ts`
  - `getPublicSettings()` now exposes `checkout.bankDetails` (server-normalised object) and `checkout.bankTransferPayable`.
- `backend/src/services/orderMutations.ts`
  - `createOrder()` resolves the order number up front, builds the payment instructions, and **rejects** a bank-transfer order with HTTP 409 when the store has no usable bank details — an unpayable order is never created.
- `src/hooks/useStoreSettings.ts` — parses `bankDetails` into typed settings.
- `src/components/checkout/BankTransferDetails.tsx` — new shared component rendering bank name, account name, account number, IBAN, SWIFT, IFSC, amount due, payment reference, and a copy-to-clipboard action.
- `src/pages/checkout/CheckoutPayment.tsx` — bank instructions are shown in the payment step.
- `src/pages/checkout/CheckoutReview.tsx` — bank instructions are shown on the review step.
- `src/pages/checkout/CheckoutSuccess.tsx` — bank instructions are shown on the confirmation screen with the amount due and the reference.
- `src/pages/Checkout.tsx`
  - Bank transfer is offered **only** when the store has payable bank details; the previous “always re-add bank transfer” fallback is gone.
  - When no payment method is usable at all, the checkout shows a “contact us” panel instead of an order form.

**U-3 / Gate 3 — a customer confirmation is sent at placement for every method**

- `backend/src/services/orderMutations.ts`
  - `createOrder()` now calls `sendOrderPlacedConfirmation()` for guest and account orders, with order number, items, totals, shipping address, payment method, currency, and (for bank transfer) the full payment-instruction block.
  - The email failure is logged and never rolls back the created order.
- `backend/src/services/emailTemplates.ts`
  - `orderConfirmation` is now the **“Order Received”** receipt, with a currency-aware money formatter, a payment-instructions block, and a `paymentPending` note.
  - New `orderPaymentReceived` template for the “money arrived” notice.
- `backend/src/services/emailSenders.ts` — `sendOrderConfirmation` accepts the new fields; new `sendOrderPaymentReceived`.
- `backend/src/services/paypalService.ts` — capture and webhook now send `sendOrderPaymentReceived` instead of a second identical confirmation.
- `backend/src/services/orderMutations.ts` — an admin marking a bank transfer paid now sends the payment-received notice, not a duplicate receipt.
- `src/locales/*.json` — `checkout.orderConfirmation` no longer promises a blanket “5-7 Business Days”; the delivery estimate now comes from the customer’s shipping zone.

**U-5 / C-4 / Gate 9 — B2B and freight fields are collected and stored**

- `backend/prisma/schema.prisma` + new migration `20261022000000_add_order_b2b_shipping_fields`
  - `shippingPhone`, `shippingCompany`, `shippingTaxId` added to `Order`.
- `backend/src/routes/storefront/orders.ts` — shipping Zod schema accepts `phone`, `company`, `taxId`.
- `backend/src/services/orderMutations.ts` — the new fields are persisted and the company appears in the confirmation email address block.
- `src/pages/checkout/CheckoutShipping.tsx` — phone (required), company, and VAT/tax-ID inputs added.
- `src/lib/address.ts` (new) — `requiresState()` / `requiresPostalCode()` so a US-style state+ZIP pair is no longer forced on countries that do not use one.

**U-6 / Gate 9 — checkout accessibility**

- `src/pages/checkout/CheckoutPayment.tsx`
  - The payment radios were `className="hidden"` (`display:none`), which removed them from the tab order. They are now `sr-only peer` inside a `<fieldset>`/`<legend>`, so they stay keyboard-operable and screen-reader-navigable, with a visible focus ring on the styled card.
- `src/pages/checkout/CheckoutShipping.tsx`
  - Every `Field` now binds `<label htmlFor>` to a real input `id`, and sets `aria-required`, `aria-invalid`, and `aria-describedby` for hints and errors.
- `src/pages/checkout/CheckoutSuccess.tsx` — the cancellation textarea has an accessible name.

**U-16 / C-6 — the order confirmation survives a refresh**

- New `src/lib/orderConfirmation.ts` — persists the order confirmation (order id, server totals, skipped items, guest email) to `localStorage` with a 24-hour TTL.
- `src/pages/Checkout.tsx` — restores the confirmation on mount; saves it after a successful order (bank transfer and PayPal).
- `src/pages/Checkout.tsx` — “Continue shopping” clears the stored confirmation.

**Gate 6 — terms, privacy, and refund acceptance at checkout**

- `src/pages/checkout/CheckoutReview.tsx` — a required checkbox with links to Terms of Service, Privacy Policy, and Refund Policy. The order cannot be placed without it; the error is announced via `role="alert"`.
- `src/pages/Checkout.tsx` — `handlePlaceOrder()` refuses to submit while the box is unchecked.
- `src/locales/*.json` — `checkout.termsAccept`, `checkout.termsAcceptError`, `checkout.termsLink`, `checkout.privacyLink`, `checkout.refundLink`.

**U-8 / U-9 / D-4 (partial) — currency and tax label**

- `backend/src/services/settingsService.ts` — new `getStoreCurrency()`; `site.currency` is exposed publicly; the order is now written with the store currency instead of a hardcoded `'USD'`.
- `src/lib/utils.ts` — new `formatMoney(amount, currency)` and `buildPaymentReference()`.
- `src/pages/checkout/CheckoutReview.tsx`, `CheckoutSuccess.tsx` — all amounts are formatted with the order currency.
- `src/locales/*.json` — `checkout.tax` is now `Tax ({{rate}}%)` and is rendered from the configured rate instead of a literal 8%.

**Verification for batch 1**

```text
backend:  npx tsc --noEmit -p tsconfig.json   → clean
frontend: npx tsc -b --noEmit                  → clean
build:    npm run build                        → 1087 pages prerendered, success
```

### Batch 2 — capture/stock atomicity, auto-refund, CI tests

**C-3 / Gate 4 — stock is reserved before the customer is charged**

- `backend/prisma/schema.prisma` + migration `20261022000001_add_order_stock_reserved`
  - `Order.stockReserved` is the ownership marker that decides which path claims the units for an order.
- `backend/src/services/centralInventory.ts`
  - New `reserveStock()` claims several order lines inside ONE transaction — all lines or none, so a partial claim can never be left behind.
  - New `releaseReservation()` puts a reservation back into stock.
- `backend/src/services/paypalService.ts` — `capturePaypalOrder()` reordered:
  1. claim the `stockReserved` marker,
  2. **reserve the stock**,
  3. capture the payment,
  4. confirm the order.
  - Reservation failure → HTTP 409, **no money taken**.
  - Capture failure/incomplete → the reservation is released and the marker cleared.
  - Captured-amount mismatch → the capture is **refunded automatically**, the stock released, and the timeline records it.
  - Order cancelled mid-capture → the capture is **refunded automatically**.
  - The reservation is only released when the order is not already marked paid, so a webhook that confirms the payment first keeps the stock claimed.
- `backend/src/services/paypalService.ts` — the webhook path now checks `stockReserved` and skips its own decrement when the capture path already claimed the units (no double decrement, no unsold units). On a stock failure with money already captured, it **refunds automatically** and marks the order `refunded`; a failed refund is recorded on the timeline for manual action.
- `backend/src/services/orderMutations.ts`
  - A bank-transfer order **reserves its stock at placement** — the units cannot be sold twice while the transfer is in flight.
  - Cancelling an unpaid order releases the reservation.
  - `updateOrderStatus(..., 'paid')` no longer decrements an order whose stock is already claimed.
  - `restoreStockAndRefund()` clears the marker when it restores the units.
- `backend/src/utils/paypal.ts` — `processPaypalRefund` is now used by the capture path (it already existed for cancellations).

**D-2 / D-3 / D-11 — tests run in CI, the typecheck can fail, Node is pinned**

- `backend/package.json` — new `test` script: `tsx --test "src/**/*.test.ts"`.
- `.github/workflows/ci.yml`
  - Node 20 → **22** (matching `engines.node`), frontend and backend.
  - Backend now runs `npm test`.
  - Frontend now runs `npm run test --if-present`.
- `.github/workflows/deploy.yml` — the root typecheck **no longer** has `continue-on-error: true`. A green check that cannot fail is worse than no check.
- `package.json` (root) — new `test` script that runs the backend suite.

**D-5 — pricing contract test**

- `backend/src/__tests__/pricingContract.test.ts` — imports **both** shipping implementations (the server's `backend/src/utils/shipping.ts` and the storefront's `src/lib/shipping.ts`) and asserts they agree for every country × cart × zone configuration.
- The test found a real divergence: the storefront resolved country labels from an 18-entry list while the server used ICU (`Intl.DisplayNames`). A zone whose region was "Italy" matched on the server but not in the client — the checkout would have shown the flat rate and the invoice charged the Europe rate.
- `src/lib/shipping.ts` now resolves country labels exactly like the server.

**New unit tests**

- `backend/src/utils/bankDetails.test.ts` — placeholder account numbers are stripped, bank transfer is payable only with an account number **and** name, the payment reference format, and the `checkout.bankDetails` override.
- `backend/src/__tests__/routeI18n.test.ts` — the backend's copy of the translated-route list must match `shared/route-i18n.mjs` exactly.

**Verification for batch 2**

```text
backend tests: npx tsx --test "src/**/*.test.ts" → 105 pass, 0 fail
backend:  npx tsc --noEmit -p tsconfig.json   → clean
frontend: npx tsc -b --noEmit                  → clean
```

### Batch 3 — pricing contract, currency, returns schema

**D-5 / U-8 / C-2 — one shipping and tax promise**

- `backend/src/services/settingsService.ts`
  - New `getStoreCurrency()` — the store's single settlement currency, validated against the supported list.
  - `site.currency` is published to the storefront.
- `backend/src/services/orderMutations.ts` — the order is written with the store currency instead of a hardcoded `'USD'`.
- `src/lib/utils.ts` — new `formatMoney(amount, currency)` and `buildPaymentReference()`; the storefront formats every amount through them.
- `src/lib/shippingPromise.ts` (new)
  - `buildShippingPromise()` — with shipping zones configured the top bar says "Shipping calculated at checkout" (the rate varies by destination); without zones it says "Free shipping above {threshold}" with the real number.
  - `buildShippingTerms()` — the Terms page bullets are generated from the same configuration.
- `src/components/layout/Navbar.tsx`, `src/pages/Home.tsx` — the shipping promise is now derived, not hardcoded.
- `src/pages/TermsOfService.tsx` — the shipping charges and the tax rate are derived from the live configuration. The old copy promised "$15 freight below $100, free above $100" and "18% GST" while the server charged $25 flat with per-zone rates and 8%.
- `src/locales/*.json` — `checkout.tax` is `Tax ({{rate}}%)`; the top bar has `topbar.freeShippingThreshold`, `topbar.shippingCalculated`.

**U-15 — the dispatch guarantee is no longer a promise**

- `src/locales/*.json` — `topbar.timelyDelivery` is now "Dispatch tracked" / "Stock and logistics updates by email" instead of "48-hour dispatch guarantee", which the terms cannot support.

**S-2 / S-3 / S-5 — the structured data matches the policy**

- `shared/product-page.mjs`
  - New `RETURN_POLICY` and `buildMerchantReturnPolicy()` — **one** definition of the return policy.
  - `returnFees` changed from `https://schema.org/FreeReturn` to `https://schema.org/ReturnShippingFees`, which is schema.org's value for "the customer must pay the return shipping costs" — exactly what the Return & Refund Policy says. The old value contradicted the policy.
  - The Product JSON-LD uses the shared helper, so the prerenderer and the SPA can no longer claim different terms.
- `src/components/seo/SEO.tsx` — the SPA fallback generator imports the same helper; the product availability fallback changed from `InStock` to `OutOfStock` (defaulting to in-stock when availability is unknown is the wrong failure mode).
- `shared/product-page.d.ts` — types for the new exports.

**U-8 / D-13 — settings are validated and redacted**

- `backend/src/services/settingsService.ts`
  - New `SETTING_KEYS` map: unknown keys and wrong types are rejected with HTTP 400. A silently-ignored typo ("checkout.taxrate") used to leave the admin believing they had changed the tax rate.
  - `getAllSettings(actor)` redacts credential-shaped values for anyone below `owner`.
  - `sanitizePaymentMethods()` — the publicly published payment-methods list no longer carries the per-method `config` (PayPal client id/secret, bank account details). Customers get the bank instructions through the deliberate `checkout.bankDetails` channel instead.
- `backend/src/routes/admin/settings.ts` — passes the actor so redaction applies.

### Batch 4 — admin RBAC, reset-token exposure, consent, analytics

**X-1 — refresh tokens are no longer usable as access tokens**

- `backend/src/middleware/auth.ts`
  - `authenticateAdmin` and `authenticateCustomer` both reject a token with `refresh: true`. Refresh tokens last 7 days (admin) and 14 days (customer); accepting one as a bearer token turned a stolen refresh cookie into a full session.

**X-3 — `viewer` can no longer read customer PII or the store configuration**

- `backend/src/middleware/auth.ts` — new `ADMIN_READ_POLICY` (a minimum role per resource) plus `requireReadAccess(resource)` and `canReadResource()`.
  - Customer PII (orders, RFQs, messages, offers, customers) → `sales-agent`.
  - Store configuration and audit history → `store-manager`.
  - Admin accounts → `owner`.
  - Catalog and dashboards → `viewer`.
- Applied at the router level in `backend/src/routes/admin/orders.ts`, `rfqs.ts`, `messages.ts`, `offers.ts`, `settings.ts`.
- `viewer` now receives **403** on those routes instead of silently enumerating customer records.

**X-4 — the password-reset token never reaches the URL, the logs, or analytics**

- `backend/src/services/authService.ts` — new `exchangeResetToken()` swaps the emailed token for a 15-minute ticket signed with the current password hash (so changing the password invalidates it).
- `backend/src/routes/storefront/auth.ts` — new `POST /storefront/auth/reset-password/verify`.
- `src/pages/ResetPassword.tsx` — exchanges the token on arrival, keeps the ticket **in memory only**, and removes the token from the address bar with `history.replaceState` **before** the network call.
- `server.js` — the access log prints the path only for routes whose query string can carry a secret (`/reset-password`, `/track-order`).
- `src/components/analytics/StoreAnalytics.tsx` — the reset route is excluded from analytics.

**U-7 — the cookie banner tells the truth and "Decline" stops tracking**

- `src/lib/consent.ts` (new) — the single source of truth for analytics consent, with a `alka:consent-change` event so an open page reacts immediately.
- `src/components/analytics/StoreAnalytics.tsx` — the GA tag loads **only with consent** and is removed when consent is withdrawn. It is configured with `send_page_view: false` because the SPA sends its own page views.
- `src/components/CookieConsent.tsx` — rewritten as a real modal dialog (`role="dialog"`, `aria-modal`, focus trap, Escape to close, focus restored on close). The copy no longer claims "we do not use third-party tracking cookies" while the privacy policy describes remarketing.
- `src/pages/PrivacyPolicy.tsx` — now states that analytics and remarketing run only after consent and that declining leaves the site fully usable.
- `src/locales/*.json` — new `cookieConsent` section in all three locales.

**D-10 — the funnel is measurable**

- `src/lib/analytics.ts` (new) — `trackPageView`, `trackEvent`, `trackAddToCart`, `trackViewItem`, `trackBeginCheckout`, `trackPurchase`. Every call is a no-op without consent.
- `src/components/analytics/StoreAnalytics.tsx` — sends a `page_view` on every SPA navigation.
- `src/hooks/useAddToCart.ts` — `add_to_cart`.
- `src/pages/Checkout.tsx` — `begin_checkout` on the review step and `purchase` after a successful order.

### Batch 5 — multilingual SEO (Gate 8)

**S-1 — AR/ES are no longer a half-indexed language layer**

The audit found three options: finish and index them, or remove them from the switcher. The locale bundles are complete and correctly translated, so the languages were finished and indexed.

- `scripts/prerender-locales.mjs` (new) — translated title, description, heading and body for all 13 static routes in Arabic and Spanish. Serving English copy on `/ar/` URLs while telling Google to index them would be duplicate content in the wrong language — worse than the noindex the audit found.
- `scripts/prerender-routes.mjs` — `LOCALES` is now `['en', 'ar', 'es']`; the route list carries `slug` and `h1`; non-English routes use their translated metadata.
- `scripts/prerender.mjs`
  - `hreflangTags()` now emits reciprocal alternates for all three locales plus `x-default` (it previously returned an empty string).
  - The prerendered `robots` meta is `index, follow` for every locale.
- `shared/route-i18n.mjs` (new) — the canonical policy: `SHIPPED_LOCALES`, `TRANSLATED_ROUTES`, `hasTranslatedRoute()`, `isIndexableRoute()`. One list, read by the server, the prerenderer and the React component.
- `server.js` — the blanket `X-Robots-Tag: noindex` for `/ar` and `/es` is replaced by the shared policy. A translated page is indexable; an English-only catalog page in Arabic stays noindex.
- `src/components/seo/SEO.tsx` — the same policy drives the meta robots and the hreflang links.
- `backend/src/utils/routeI18n.ts` + `backend/src/__tests__/routeI18n.test.ts` — the backend API is deployed from `backend/` only and cannot import the shared module at runtime, so it keeps a deliberate copy that a contract test keeps identical.
- `backend/src/services/sitemapService.ts` — the sitemap now emits every translated static route in every locale, each with `xhtml:link` hreflang alternates and an `x-default`.

**Result:** `/ar/` and `/es/` are prerendered with translated titles, headings and crawlable copy, are indexable, declare reciprocal hreflang, and appear in the sitemap. The catalog pages (English product data) stay English-only and noindex in the other locales.

**Verification for batches 3–5**

```text
backend tests: 105 pass, 0 fail
backend:  npx tsc --noEmit -p tsconfig.json   → clean
frontend: npx tsc -b --noEmit                  → clean
build:    npm run build                        → 1113 pages prerendered (39 static AR/ES pages added)
```

### Batch 6 — one SEO route manifest, structured-data golden test, root tests in CI

**S-4 / D-8 — static page metadata has exactly one definition**

The audit found the same page described in three independent places, and the
copies had already drifted (the catalog page was `Marine Spare Parts & Ship
Spares Catalog` in the prerendered HTML and `Marine Spare Parts Catalog | Ship
Spares & Engine Parts` in the server fallback; `About` dropped the brand suffix
entirely once React mounted).

- `shared/static-pages.mjs` (new) — canonical English `title`, `description`
  and `h1` for all 13 static routes, plus `getStaticPageMeta()`.
- `shared/static-pages-i18n.mjs` (new) — the Arabic and Spanish `title`,
  `description` and `h1` for the same 13 routes.
- `scripts/prerender-routes.mjs` — no longer carries its own titles or
  descriptions; it merges the shared metadata with its build-time body copy and
  throws if a route has no manifest entry.
- `scripts/prerender-locales.mjs` — 286 → 200 lines: now holds only the
  long-form Arabic/Spanish body paragraphs, and builds `LOCALE_ROUTE_META` by
  merging the shared localized metadata. The extraction was verified by
  diffing all 39 prerendered routes (title, description, h1, body) against a
  snapshot taken before the refactor: byte-identical.
- `server.js` — the duplicate 3.5 KB `STATIC_PAGE_META` literal is gone; the
  fallback shell now imports the shared manifest, so a missing prerendered file
  cannot describe a page differently from the deployed HTML.
- `src/lib/seo/staticPageSeo.ts` (new) — `staticPageSeo(slug, language)` and
  `useStaticPageSeo(slug)`; every static page now renders its title and
  description from the manifest instead of a literal.
  - Updated: `About`, `Brands`, `Contact`, `Emergency`, `Industries`,
    `Intelligence`, `Network`, `PrivacyPolicy`, `RFQ`, `RefundPolicy`,
    `TermsOfService`.
  - The hydrated AR/ES title now matches the prerendered one, which previously
    was replaced by an English literal after mount.
- `shared/static-pages.d.ts`, `shared/static-pages.d.mts`,
  `shared/static-pages-i18n.d.ts`, `shared/static-pages-i18n.d.mts` — types for
  the React/TypeScript side.
- `tests/static-pages.test.mjs` (new) — fails if a manifest slug is not
  prerendered, if the prerendered HTML drifts from the manifest, if an AR/ES
  entry is missing or untranslated, or if two pages share a title.

**S-5 — structured data is guarded by a golden test**

- `tests/structured-data.test.mjs` (new) — asserts the shared return policy
  (`ReturnShippingFees`, 30 days, `ReturnByMail`), that no layer claims
  `FreeReturn`, that the prerendered product JSON-LD carries that exact policy
  and no invented `shippingDetails`, and that `SEO.tsx` imports the shared
  helper instead of hard-coding a second policy. The policy value appears once
  in code, in `shared/product-page.mjs`.

**D-2 — the root test step no longer depends on backend `node_modules`**

The old root `npm test` ran `npm --prefix backend test`, so the CI frontend job
(which never installs backend dependencies) and the deploy frontend job could
otest a missing `tsx` binary. Split and run the right suite in each job:

- `package.json` — `test` runs the new root Node suite
  (`node --test "tests/*.test.mjs"`); new `test:backend` runs the backend suite.
- `.github/workflows/ci.yml` — frontend job runs `npm run test` (root suite);
  backend job keeps `npm test` (backend suite).
- `.github/workflows/deploy.yml` — frontend job runs `npm run test`.
- `.github/workflows/ci.yml` — the frontend type check is now
  `npx tsc -b --noEmit` (the previous `npx tsc --noEmit` pointed at a
  references-only solution file, so it could not fail).

**U-14 / C-5 — trust copy matches the terms**

- `src/data/testimonials.ts` — the FAQ answer claimed "we only supply OEM and
authorized distributor stock" and that conformity/test/material certificates
"come with every shipment". The Terms of Service state that the business deals
in old and used items with no warranty. The answer now describes condition
grades, says used/surplus items are sold as inspected without a manufacturer
warranty, and says certificates are supplied only when the supplier issues them
and they are named in the quotation.
- `src/pages/admin/settings/types.ts` — the defaults no longer present a UAE
phone number, `Asia/Dubai`, an Emirates NBD account and a UAE IBAN for the
Indian entity. Default phone is the real Bhavnagar number, timezone is
`Asia/Kolkata`, and the bank method starts with **empty** account fields so
`isBankTransferPayable()` keeps bank transfer off at checkout until an admin
enters real details. L/C keeps its generic document list but drops the invented
accepting-bank list.
- `src/components/admin/customers/*` — phone placeholder is an Indian format.
- `MANUAL_TASKS.md` — new **MT-16** (replace the eBay tool reviews with real
marine references) and **MT-17** (enter real company and bank details), because
both need data only the owner has.

**CI lint was red — fixed**

`npm run lint` failed with a real `react-hooks/immutability` error in
`src/components/CookieConsent.tsx`: the focus-trap effect called `decline()`
before its declaration, so Escape captured a stale binding. `accept` and
`decline` are now `useCallback`s declared above the effect and listed in its
dependencies, and the now-unused `eslint-disable` directive is gone. CI could
not go green with that error.

**Verification for batch 6**

```text
lint:         npm run lint                  → clean
root tests:   npm test                      → 9 pass, 0 fail
backend tests: npm run test:backend         → 109 pass, 0 fail
backend:      npx tsc --noEmit              → clean
frontend:     npx tsc -b --noEmit           → clean
build:        npm run build                 → 1113 pages prerendered
prerender spot check:
  /en/about/    "About Us - Marine Equipment Specialists | Alka Traders"
  /ar/about/    "من نحن - متخصصون في المعدات البحرية | Alka Traders"
  /en/products/ "Marine Spare Parts & Ship Spares Catalog | Alka Traders"
  → title, description and robots now agree with the manifest
```

### Batch 7 — checkout integrity, trust copy, registration and residual metadata

**U-4 — an unavailable cart line no longer creates a partial order**

- `backend/src/services/orderMutations.ts` — the availability loop now collects
  `unavailableItems` instead of silently dropping lines. If any line is gone,
  unpublished, or out of stock, the function throws a `409` **before** the
  order, items, or timeline are written. The timeline note is simply
  `Order placed`; there is no “skipped items” postscript to explain a partial
  order.
- `backend/src/routes/storefront/orders.ts` — forwards `details` to
  `sendError`.
- `backend/src/middleware/response.ts` — `sendError` already supported the
  `details` array; verified rather than changed.
- `src/lib/api.ts` — exports `ApiError` from the core client.
- `src/pages/Checkout.tsx` — a `409` with `details` removes exactly the named
  cart lines through `removeFromCart`, shows one clear message, leaves the
  rest of the cart and the customer's address intact, and makes the customer
  press “Place Order” again. The PayPal create-order path uses the same
  handler without letting PayPal's generic `onError` overwrite the specific
  message.
- `src/locales/{en,ar,es}.json` — `checkout.itemsUnavailable`.

**U-14 / C-5 — marketplace feedback is no longer passed off as marine proof**

- `src/components/sections/Testimonials.tsx` — the eBay reviews are now
  explicitly introduced as feedback from buyers of the industrial tooling and
  surplus equipment sold on eBay. The old “Trusted by Procurement Teams
  Worldwide” heading was unsupported by six pipe-tool reviews.
- `src/locales/{en,ar,es}.json` — `testimonials.label`, `title` and `note` say
  “Marketplace Feedback” and “Verified feedback from our eBay buyers”.
- `src/pages/admin/settings/types.ts` — default tagline is now
  `Marine Spare Parts, Surplus & Industrial Equipment` rather than the
  contradictory “Used & Unbranded” shorthand. The honest FAQ answer and the
  empty bank/L/C defaults from Batch 6 remain.
- Real marine references are still **MT-16**; they need customers willing to be
  quoted.

**X-10 — registration no longer reveals whether an email exists**

- `backend/src/services/authService.ts` — an existing address triggers the
  normal password-reset email and returns a generic “check your inbox” result
  instead of an explicit “Email already registered” error; no session is
  created for an existing account. A determined attacker can still infer
  existence from whether a session is issued; full non-enumerability would
  require email verification, which the store does not have yet.
- `backend/src/routes/storefront/auth.ts` — returns `201` with the generic
  message instead of setting cookies.
- `src/lib/api/auth.ts`, `src/store/useStore.ts`, `src/components/auth/AuthModal.tsx`
  — the client treats the response as a neutral notice, not a login, and does
  not create an authenticated session without tokens.

**D-8 / S-4 residual — the home page joins the shared manifest**

- `src/pages/Home.tsx` — the hard-coded `HOME_SEO_TITLE` /
  `HOME_SEO_DESCRIPTION` constants are gone; the fallback title and
  description now come from `useStaticPageSeo('')`. Admin-configured SEO
  settings still override them. The other static pages, the prerenderer and
  the server fallback already used the manifest.

**S-2 residual — the return policy is global, not Indian**

- `shared/product-page.mjs` — removed the hard-coded `applicableCountry: 'IN'`
  from `RETURN_POLICY`. The refund policy has no country restriction and the
  store ships globally, so the structured data no longer claims a narrower
  scope. `buildMerchantReturnPolicy()` emits a country only when a caller
  explicitly overrides one.
- `tests/structured-data.test.mjs` — guards the absence of the default country.

**C-4 residual — heavy freight has a route out of the consumer cart**

- `src/pages/checkout/CheckoutReview.tsx` — the review step now tells buyers
  that zone rates cover standard parcels and links heavy/oversized freight,
  proforma invoices, and packing lists to the RFQ flow. A full quote-to-order
  workflow is still a product decision, not something the cart can invent.
- `src/locales/{en,ar,es}.json` — `checkout.freightQuote*`.

**Documentation for the two remaining operational items**

- `docs/dependency-audit.md` — the actual `npm audit` results for both
  lockfiles, the production-relevant findings, and the recommended
  major-version upgrade path. No dependency was upgraded in this batch.
- `docs/backup-restore.md` — Neon point-in-time restore, test-restore steps,
  single-order recovery, image recovery, deploy rollback, and post-incident
  checks. The provider-side test restore is still **MT-7**.

**Verification for batch 7**

```text
root tests:    npm test                        → 9 pass, 0 fail
backend tests: npm test --prefix backend       → 109 pass, 0 fail
frontend:      npx tsc -b --noEmit             → clean
backend:       npx tsc --noEmit -p backend/tsconfig.json → clean
lint:          npm run lint                    → clean
build:         npm run build                   → 1113 pages prerendered
```

### Batch 8 — final gate reconciliation (Gates 4, 5, 6, 9 and the verified high/medium items)

**Gate 6 — acceptance is enforced by the server and persisted**

- `backend/prisma/schema.prisma` + migration `20261023000000_add_order_terms_acceptance`
  - `Order.termsAcceptedAt` and `Order.termsVersion` record what the customer accepted and when. The columns are nullable only for legacy/admin-created orders.
- `backend/src/utils/legal.ts` — `CURRENT_TERMS_VERSION` is the server-stamped version.
- `backend/src/services/orderMutations.ts`
  - `createOrder()` rejects `termsAccepted !== true` with HTTP 400 before any order row is written, then stamps the acceptance time and version.
- `backend/src/routes/storefront/orders.ts` — the order schema forwards `termsAccepted`; the service remains the authority.
- `backend/src/services/offerService.ts` + `backend/src/routes/storefront/offers.ts`
  - Accepted-offer checkout requires the same `termsAccepted: true` and stamps the same proof on the order. A direct API call cannot bypass the checkbox.
- `src/pages/Checkout.tsx`, `src/pages/checkout/CheckoutReview.tsx`
  - The checkbox is still a UX guard, but the PayPal button now also rejects at `onClick`, and unchecking it discards a pre-created order so it cannot be charged.
- `src/pages/account/OfferCheckout.tsx` — accepted-offer checkout has the same checkbox, links, error announcement, and PayPal click guard.

**Gate 5 — domestic-only tax and one settlement currency**

- `backend/src/utils/country.ts` + `src/lib/tax.ts`
  - Country names, ISO codes, and aliases resolve identically. The "UK" alias is resolved before the two-letter shortcut, so a store set to "UK" charges tax on "GB" orders and vice versa.
- `backend/src/services/orderPricing.ts`
  - Tax is charged only when the shipping country matches the store's domestic country (`site.country`, then `DEFAULT_COUNTRY`, then `IN`). Export orders are not charged domestic tax.
- `backend/src/services/settingsService.ts`
  - `getStoreCurrency()` is the single settlement currency. Public settings now expose the resolved domestic country as well as the currency, so the checkout estimate and the server use the same fallback.
- `backend/src/services/orderMutations.ts`
  - Every product line must be priced in the store currency. A mismatch returns HTTP 400 instead of charging the numeric amount in the wrong currency; no FX conversion is implied.
- `backend/src/services/offerService.ts`, `offerAdminService.ts`, `rfqService.ts` — accepted-offer, admin-conversion, and RFQ-conversion orders use the store currency.
- `backend/src/routes/storefront/payments.ts` + `src/components/PayPalProvider.tsx`
  - The PayPal SDK is initialized with the store currency, not a hardcoded USD.
- `src/hooks/useStoreSettings.ts`, `src/pages/Checkout.tsx` — the review tax line is domestic-only and uses the same country fallback as the server.
- `src/components/ui/ProductCard.tsx`, `src/components/product/ProductGrid.tsx`, `src/components/product/RelatedProducts.tsx`, `src/pages/ProductDetail.tsx`, `src/components/cart/CartDrawer.tsx`, `src/pages/TrackOrder.tsx`, `src/pages/account/OrderHistory.tsx`, `src/pages/account/MyOffers.tsx`
  - Customer-facing prices use `formatMoney` instead of a literal `$`; product displays use the product currency when present and the store currency otherwise.

**Gate 4 — reservation/webhook race**

- `backend/src/services/paypalService.ts`
  - The capture and webhook stock pre-flights now skip the shelf-count check when `stockReserved` is already true. The capture path decrements stock before charging; re-checking the remaining count could otherwise see zero and wrongly auto-refund a correctly reserved order. The marker remains the single ownership authority.
  - Cancellation and the PayPal capture/webhook paths now claim the reservation atomically before releasing it. A cancellation racing an in-flight capture can no longer restore the same units twice.
  - If a cancellation lands between the webhook's initial read and its atomic `paid` transition, the webhook now refunds the captured money, releases any reservation the cancellation did not release, and records the outcome on the timeline.
  - Cancelled-order captures and post-capture stock failures still auto-refund; a failed refund is recorded on the timeline for manual action.

**Residual P1/P2 code items**

- `backend/src/services/orderMutations.ts`
  - Idempotency replay is scoped by customer id or guest email, and a `P2002` unique-constraint race re-reads the winner only when the scope matches.
- `backend/src/middleware/auth.ts`, `backend/src/utils/sessionVersion.ts`, `backend/src/services/authService.ts`
  - Refresh tokens are rejected on access routes; every token must carry the current `tv` session version; refresh and optional-auth paths enforce it. Tokens without `tv` are invalid and require a fresh sign-in.
- `.github/workflows/deploy.yml`, `package.json`
  - The deploy job runs `build:frontend:full` (typecheck, Vite, prerender, copy), not just Vite.
- `src/pages/TrackOrder.tsx` — order-number and email inputs have real labels, not placeholder-only fields.

**Verification for batch 8**

```text
root tests:    npm test                        → 9 pass, 0 fail
backend tests: npm test                        → 111 pass, 0 fail
frontend:      npx tsc -b --noEmit             → clean
backend:       npx tsc --noEmit                → clean
lint:          npm run lint                    → clean
build:         npm run build:frontend:full     → succeeded
```

---

## 16. Remaining work

Everything that is left needs either a decision, a credential, content the
code cannot invent, or a deployment/browser step. Apply the pending additive
migrations before starting the new API; the rest of the list does not block a
standard card/PayPal or bank-transfer order.

| ID | Item | Why it is open |
|---|---|---|
| — | Apply pending additive migrations | Deploy prerequisite: `20261023000000_add_order_terms_acceptance` adds the terms columns. Run `npm run db:migrate:deploy` before the new API starts |
| Gate 9 verification | Browser-only axe/keyboard checkout pass | The structural fixes are in code; the scan needs a running storefront and a customer session, the same environment decision as D-2 |
| U-14 / C-5 | Marine references alongside the now-honest marketplace feedback block | The eBay reviews are accurately labelled; real marine customers willing to be quoted are still needed — **MT-16** |
| C-5 / U-2 | Real company, bank and L/C details in store settings | Needs the owner's account data — **MT-17**; bank transfer stays off until then |
| D-2 (rest) | Playwright specs in CI | `e2e/` runs against the live site (`BASE_URL`), and `admin-product-flow.spec.ts` needs an admin session. Decide the target environment before wiring a job |
| S-6 | Technical content hub (guides, not SKUs) | Strategy and editorial content, not a code fix |
| C-4 (residual) | Full freight-quote/proforma workflow in checkout | The checkout now routes heavy freight and proforma requests to the RFQ flow, but quote-to-order needs pricing, approval, and document rules from the business |
| X-9 (residual) | CSP still allows `style-src 'unsafe-inline'` | Inline styles are used throughout; tightening needs a nonce/hash migration |
| — | Dependency / supply-chain audit | Audit run and findings recorded in `docs/dependency-audit.md`; the upgrade PR (including the critical `proxy-addr` path) and an auto-update policy still need a decision |
| — | Backup/restore and migration runbook | Runbook written in `docs/backup-restore.md`; the provider-side test restore and retention check are still **MT-7** |
