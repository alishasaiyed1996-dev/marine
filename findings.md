# Alka Traders — Full-Stack Completeness & Logic Audit (findings.md)

**Purpose:** Answer one question honestly — *"Is this a complete e-commerce site, wired up end-to-end everywhere, or are there broken/missing/incomplete flows?"*
Unlike `PRODUCTION_AUDIT.md` (deploy/security/SEO focus), this audit reads **every page, every file, every DB table** from the perspective of:
1. a **real customer-user** ("where's my order email? why can't I…?"),
2. a **support agent / owner** ("how do I fulfil, refund, message this customer?"),
3. a **QA tester** (happy path + abuse path + edge path per feature).

**Method:** Iterative loop — audit an area → append numbered findings below → continue. Every finding has *evidence* (file/line) and *severity* (🔴 broken / 🟠 incomplete / 🟡 weak / 🔵 note / ✅ verified-good).

**Status:** ✅ `COMPLETE` — all phases done (2026-10-29). Read-only audit: no source file touched; `findings.md` is the deliverable. Kick-off point for fixes = the launch-gate + Tier-A list in P7.

---

## Master plan (phases)

| Phase | Scope | Status |
|---|---|---|
| **P0 — Map** | Inventory, route map, frontend↔backend wiring map | ✅ done |
| **P1 — Database** | Prisma schema vs migrations vs actual usage; every model traced; indexes/constraints/races/retention | ✅ done (2026-10-29) |
| **P2 — Money path** | Cart → checkout (4 steps) → pricing recompute → PayPal capture → webhook → stock decrement → email → admin fulfil → cancel/refund | ✅ done (2026-10-29) |
| **P3 — Accounts** | Register/login/CSRF/tokenVersion/reset password/profile edit/guest checkout/token expiry | ✅ done (2026-10-29) |
| **P4 — Catalog + inquiries** | Products, ProductDetail, Category/Brand/Industry hubs, Search, RFQ, Emergency, Contact, TrackOrder | ✅ done (2026-10-29) |
| **P5 — Admin console** | All 17 admin pages vs admin API: can the owner actually do the job? | ✅ done (2026-10-29) |
| **P6 — Cross-cutting** | Auth wiring, cart store lifecycles, i18n (en/es/ar), SEO, emails, PWA/service worker, stale UI data | ✅ done (2026-10-29) |
| **P7 — Synthesis** | Completeness verdict + prioritized fix backlog | ✅ done (2026-10-29) |

---

## Backend route map (P0)

- **Storefront** (`/api/*` under server.ts): products, categories, brands, industries, search, auth, orders, payments, offers, rfq, contact, settings, merchantFeed
- **Admin** (`/api/admin/*`): auth, products, orders, offers, rfqs, categories, brands (+brand-logo), industries, messages, customers, users, media, settings, dashboard, audit, ebay
- **Webhooks**: paypal, ebay
- **Other**: sitemap

## Page map (P0)

- **Storefront pages** (23): Home, Products, ProductDetail, CategoryHub, BrandHub, Brands, Industries, Emergency, RFQ, Contact, Search, TrackOrder, About, Checkout (+4 step pages, + success), account/{ProfileEdit, OrderHistory, MyOffers, OfferCheckout}, ForgotPassword, ResetPassword, legal (Privacy/Terms/Refund), NotFound, Maintenance, Network, Intelligence
- **Auth components**: AuthModal, LoginForm, RegisterForm (modal-based, no dedicated login page)
- **Admin pages** (17): Dashboard, Products, ProductForm, Orders, RFQs, Offers, Customers, Messages, Categories, Brands, Industries, Media, Settings, Users, AuditLog, Insights, eBayInventory, Login

### Wiring map (frontend api lib → backend route)
- `src/lib/api/storefront.ts` → storefront routes
- `src/lib/api/admin.ts` → admin routes
- `src/lib/api/auth.ts` → auth routes
- `src/lib/api/core.ts` → CSRF handshake + fetch wrapper


## P1 — DATABASE findings ✅ (2026-10-29)

**Overall: the database layer is genuinely well-built.** All 22 migrations exist and align with the schema; money is `Decimal(12,2)`; every stock write goes through one atomic inventory service; the email queue has durable retries. Findings below are what remains broken or unwired.

### P1-1 🔵 Dead table: `RfqItem` / `rfq_items` has zero writers
- Evidence: `Grep prisma.rfqItem.` → **0 usages in 0 files** (whole backend). `schema.prisma:490-505` defines it with FK+index; `prisma-helpers.ts:102` (`rfqInclude.items: true`) selects it in every RFQ response — always `[]`.
- Impact: none functionally (RFQs store product/quantity as flat columns), but it is completed schema+relation Dead-wire — a fake "multi-item RFQ" capability that doesn't exist. Support staff may believe logged RFQs have item lists.
- Fix: drop the model (or implement multi-item RFQ submission from the storefront — customer questions for bulk RFQ suggest multi-item is expected).

### P1-2 🟠 `Rfq.firstResponseAt` is never written — SLA measurement is broken while the *promise* is displayed nowhere
- Evidence: schema `firstResponseAt` (`schema.prisma:473`) + `responseDeadline` — `grep firstResponseAt` hits only the schema and `shared/types.ts:266`; **zero writes/reads in src/**. `respondToRfq()` (`rfqService.ts:213-237`) updates status + note but never stamps `firstResponseAt`.
- Impact: "2-hour emergency / 24-hour urgent response" guarantee — generated at submission — is **measurable in code but never measured, and never shown to the customer** (front-end has no SLA view at all; `ResponseCountdown` is a static marketing countdown). Support can't tell whether they met the promise.
- Fix: stamp `firstResponseAt` in `respondToRfq`/first `rfqNote`; surface `responseDeadline`/actual response in the admin RFQ drawer.

### P1-3 🟡 Admin RFQ list sorts 'urgent' *below* 'standard'
- Evidence: `listRfqs` orders `[{ urgency: 'asc' }, { createdAt: 'desc' }]` (`rfqService.ts:114`). Alphabetical order: `emergency < standard < urgent`.
- Impact: the **24-hour-urgent queue sorts last** while plain standard RFQs appear above it — support staff working top-down handle standard inquiries before urgent ones. Silent priority inversion.
- Fix: map urgency to explicit priority (emergency=0, urgent=1, standard=2).

### P1-4 🟡 Emergency form auto-creates RFQs with **the store's own email as the customer address**
- Evidence: `contactService.ts:48` — `email: 'sales@alkatraders.co'` hardcoded into the auto-RFQ; `consent: true` without a `consentAt` timestamp (`contactService.ts:53`).
- Impact: (a) emergency leads pollute RFQ/customer analytics with a self-referential address (responding "to the customer" emails the store); (b) RFQ→customer linking (`convertRfqToOffer` matches `customer.email`) would create offers bound to the store email; (c) no real customer record exists for that lead, so it exists only in the emergency table. Works as an alert relay, but it's a half-wired lead.
- Fix: leave `email` null-able in emergency flow (requires schema relax) or make the flow NOT create an RFQ at all — EmergencyRequest alone + admin call log is enough.

### P1-5 🟠 Missing index on `orders.shippingEmail` (guest track/cancel + admin search)
- Evidence: `orderQueries.ts:140-146` (`trackOrder`) and `orderMutations.ts:499-501` (guest cancel) query `shippingEmail` equality on every track/cancel attempt; schema has indexes on `customerId/status/orderNumber/createdAt` but **not** `shippingEmail`; admin search also `contains`-scans it (`orderQueries.ts:30`).
- Impact: with order volume from eBay imports + years of B2B use this degrades to Seq Scan per lookup. Not user-visible today; an index is a one-line migration.
- Fix: `@@index([shippingEmail])` (and consider lowercase normalization — emails are normalized to lowercase elsewhere, migration `20261022000002_normalize_emails_to_lowercase` exists for customers/offers).

### P1-6 🟠 No retention job for `email_queue`, `webhook_logs`, `ebay_event_log`
- Evidence: `email.ts` keeps every queue row (status pending/sent/failed) forever; `paypalService.logWebhookEvent` writes full PayPal payloads (buyer email, address) without any pruning; no cleanup scheduler exists (server.ts starts 7 schedulers, none is a cleanup).
- Impact: unbounded growth + **PII retention** in `webhook_logs`/`ebay_event_log` (Privacy-Policy hygiene), and the email queue's usefulness (admin debugging "did the mail go?") decays as the table fills.
- Fix: nightly prune (e.g. sent > 30d, failed > 90d, webhook/event logs > 30d).

### P1-7 🟡 `exportOrdersCsv` exports almost nothing usable
- Evidence: `orderQueries.ts:157-162` — columns: order number, status, payment status, total, date. No customer email/name, no items, no SKU, no shipping country.
- Impact: (support/owner persona) "Download CSV" in Admin Orders can't be used for accounting, label printing, or reconciliation — re-parse in Excel adds columns by hand. Silver lining: because no free-text user columns are exported, there's no CSV-formula-injection surface thanks to the narrow export.
- Fix: add customer email/name, item SKUs + qty, country; keep formula-injection guard when adding free text.

### P1-8 🟡 Settlement-currency list contains currencies PayPal cannot charge
- Evidence: `settingsService.ts:220` `SUPPORTED_CURRENCIES = ['USD','EUR','GBP','AED','INR','SGD','JPY']`; `paypalService.createPaypalOrder` sends `currency_code: order.currency` with `value: Number(...).toFixed(2)`.
- Impact: an owner switching `site.currency` to **INR** (PayPal does not settle INR) or a zero-decimal JPY (amount format) ships a storefront where every PayPal create-order 400s at PayPal — orders exist but can never be paid. Bank transfer would keep working, so the site won't collapse, just PayPal checkout.
- Fix: either remove INR/JPY from the settlement list (with a UI warning on other exotic ones) or branch amount formatting per zero-decimal currency.

### P1-9 🔵 Settings has an accepted-but-dead key `site.phoneNumber`
- Evidence: `SETTING_KEYS` (`settingsService.ts:23`) accepts it; `getPublicSettings` publishes only `site.phone`; no reader anywhere.
- Impact: an admin can "fix" the phone number under a key nothing reads and conclude the site is broken. Trivial to delete from the whitelist.

### P1-10 ✅ Verified good (for the record)
- 22 migrations incl. lowercase-normalization, tokenVersion, idempotency key, terms acceptance, B2B shipping fields, hub slug history, eBay mirrors — schema fits the code, no drift found between schema and migrations.
- Money as `Decimal(12,2)` everywhere; per-order currency column; per-product currency guard at order time.
- Stock: single atomic service (`centralInventory.ts`), conditional `UPDATE … WHERE stock_count >= q`, transactional multi-line reservation, `stockReserved` ownership marker shared by capture path + webhook path + admin path, stale-reservation sweep for crashed PayPal checkouts with env-tunable windows, eBay mirrors updated only after central commit. This is beyond what most production stores do.
- `StoreSetting` typed-key whitelist prevents "configured but ignored" typos; secret-shaped keys redacted for non-owner roles; public settings endpoint strips credential config blobs.
- Availability flag sync + eBay sync enqueue after commit; `setStock` retry for concurrent edits.

---

## P2 — Money path (checkout/orders/PayPal) ✅ (2026-10-29)

### P2-1 🔴 Customer **cancel-request** emails say "your order has been cancelled" while the order is NOT cancelled
- Evidence: `orderMutations.ts:524-528` (`requestOrderCancellation`) → `sendOrderCancelled` immediately on request; `emailTemplates.ts:175` text: *"your order … has been cancelled."* The order's `status` field is untouched (cancellation is only a flag `cancelRequested=true` until an admin acts, `orderMutations.ts:507-511`).
- Impact: customer believes the order is dead, usually re-orders → duplicate shipments; support tickets can't be answered with "it was just a request"; if the admin later ships the order anyway, the customer has already written it off. This is the kind of inconsistency a support team gets phone calls about.
- Fix: template must distinguish requested vs. decided — either a "we received your cancellation request" template, or cancel triggering an actual `status='cancelled'` transition (store-design choice).

### P2-2 🐛 Invoice SKU column is always blank
- Evidence: `generateInvoiceHtml` (`orderMutations.ts:715-730`) renders `item.product?.sku || item.sku`, but the query includes `orderInclude` whose items select has **no** `product` relation and only the `productSku` field (`prisma-helpers.ts:83-87`) — both branches are `undefined` → `''`.
- Impact: every invoice (customer-facing payment document for bank transfers!) lacks the one identifier a bookkeeper/warehouse needs. The SKU data exists (`productSku`), the template just reads the wrong names. Same fallback saves the name column (`productName`), so only SKU is lost.
- Fix: `item.productSku?.trim()` — one-word fix.

### P2-3 🟡 `updateTracking` fires the "shipped" email without moving the order status — and re-fires on every edit
- Evidence: `orderMutations.ts:646-666` — sets `trackingNumber/courier`, sends `sendOrderShipped` immediately; never touches `order.status` (that must be advanced separately through the status dropdown), and there is no "tracking already existed" guard.
- Impact: (a) customer receives "your order ships with ABC…" while admin status may still be `processing` — TrackOrder page will show status≠shipped, contradicting the email; (b) editing/typo-fixing the tracking number sends duplicate "shipped" emails. 
- Fix: set status to `shipped` (or at least require it) when tracking is first added; email only on first tracking.

### P2-4 🟡 Order status can only move *forward*, even for admin corrections
- Evidence: `STATUS_FLOW` (`orderMutations.ts:19`) + `newIdx <= currentIdx → "Can only advance order status forward"` (`orderMutations.ts:548`).
- Impact: a shipped-by-mistake order can never go back to `processing`; only cancellation (which refunds + restocks) is available. Support teams flag this the first time someone clicks the wrong button.
- Fix: allow downward moves with an audit note, or an "undo" for the most recent admin status change.

### P2-5 🟠 `cancelRequested` flag is stored but has no admin-attention surface in the API
- Evidence: `listOrders` (`orderQueries.ts`) doesn't filter/sort by `cancelRequested`; no admin endpoint combines it. (Admin UI check pending in P5 — if the OrderTable doesn't badge it, a requesting customer's cancel request can sit unnoticed indefinitely since nothing else surfaces it.)
- Fix pending P5 verification.

### P2-6 ✅ Verified good (createOrder & PayPal capture)
- Idempotency: dedicated unique column, scope-match (customer id vs. guest email), `P2002` catch-and-reconcile — double-click checkouts can't duplicate orders (`orderMutations.ts:179-197, 330-350`).
- Unavailable lines: server refuses the order and returns per-product `details` so the client removes exactly those lines — no silent order mutation (`orderMutations.ts:219-268`).
- Currency guard per product line; server-authoritative totals (client never posts money values); date-aware sale pricing via `getEffectivePrice`; terms acceptance stamped with server-side `CURRENT_TERMS_VERSION`.
- Bank/LC orders pre-reserve stock at placement and delete the order (pre-confirmation!) if reservation fails — confirmation email can never describe a deleted order (`orderMutations.ts:356-375`).
- PayPal capture: ownership cross-check of `paymentIntentId`, capture-idempotency, **captured-amount verification with auto-refund on mismatch**, race-safe `stockReserved` claims between the redirect path and the webhook path, auto-refund + restock when capture lands on a cancelled order (`paypalService.ts:636-902`), webhook-only "cancelled+refund failed" triage with explicit timeline notes.
- Guest orders: payment-received + order-placed emails fall back to checkout email; own-order listing cancels are scoped by customer or checkout email — IDOR-hardened throughout.
- Accepted offers: PayPal-only checkout path with minimum-offer price validation, panic guards (open-offer ceiling, per-email/IP daily budgets using normalized lowercase email — `offerService.ts:72-94`).

---

## P2-frontend — Cart & checkout UI ✅ (2026-10-29)

### P2F-1 🔵 Dead client-side pricing fields in the checkout POST (harmless)
- Evidence: `Checkout.tsx:334-367` posts per-item `price` plus `subtotal`, `tax`, `total`; the backend `orderSchema` (`routes/storefront/orders.ts:32-43`) only accepts `{productId, quantity}` — zod strips the rest silently, the server prices everything (`orderPricing.ts`).
- Impact: none at runtime; an audit trap ("is the client dictating prices?"). Drop the fields or make the schema reject unknown keys.

### P2F-2 🔵 Provisional client-ID generators imitate *different* real identifiers
- Evidence: `useStore.ts:323-324` `generateRfqId()` → `AT-<10000..99999>` (5 digits); `useStore.ts:547-549` `generateOrderId()` → `AT-ORD-<random>`. Real IDs: order `AT-…` from `generateOrderNumber`, RFQ long token shown in production (`AT-MVQQIAPGRYE3`). Checkout itself never uses the provisional IDs (uses `result.order.id` / `orderNumber`).
- Impact: any page still rendering these provisional values would quote customers a number the merchant can never find in the database. Pending grep across remaining pages before declaring dead.
- Fix after verification: delete both generators and all references.

### P2F-3 ✅ Verified good (checkout UX correctness)
- PayPal-return capture survives the empty-cart guard and empty cart only after success; double-submit protected (idempotency key per session, rotated after each placed order); a pre-created store order for PayPal is fingerprint-invalidated when shipping/cart/method/terms change (`Checkout.tsx:163-174, 465-467, 505-508`) — customers can never confirm stale details.
- 409-with-`details` unavailable-lines handling removes exactly those cart lines and names them to the customer (`Checkout.tsx:434-451`).
- Success page renders **server-authoritative** totals; bank transfer + L/C show on-page payment instructions; confirmation persists 24h in localStorage so a refresh cannot orphan a bank-transfer customer (`orderConfirmation.ts` TTL; `CheckoutSuccess.tsx:55-79`); guest email handed to TrackOrder via sessionStorage, never the URL.
- Payment methods render only when actually payable (bank account configured / PayPal configured / L/C present) with a real "no payment methods → contact" dead-end page (`Checkout.tsx:240-265, 629-654`).
- TrackOrder: guests require checkout email; signed-in users search their scoped list (`TrackOrder.tsx` + `trackOrder` server-side fallback to `customer.email`); status stepper maps packed/shipped/delivered sensibly; tracking + address + WhatsApp support link shown.
- GA4 events fire once each (begin_checkout at review; purchase with server totals).

## P3 — Accounts & sessions ✅ (2026-10-29)

### P3-1 ✅ Verified good (auth architecture)
- CSRF: HMAC double-submit cookie + header, 1h expiry, constant-time compare, **fail-closed when a session cookie exists**, skips webhooks (PayPal signature instead), refresh endpoints (httpOnly-cookie only, CSRF-irrelevant), and cookieless bearer requests (`csrf.ts:87-170`). Frontend caches the token 50 min and dedupes concurrent fetches (`core.ts:64-104`).
- Sessions: separate admin/customer refresh cookies (no mutual overwrite); tokens carry `tokenVersion`; refresh verifies it; short access lifetimes (admin 15 min, customer 1h); logout bumps the version server-side so a stolen access token dies in seconds; refresh-token-as-access-token and customer-token-on-admin-route explicitly rejected (`auth.ts:44-57, 109-113`).
- Password reset: token signed with `JWT_SECRET + passwordHash` (auto-invalidated on password change), exchanged for a 15-minute in-memory ticket so the emailed URL token never lingers in history/logs/analytics.
- Register is enumeration-safe: existing email triggers a real forgot-password email and returns the same 201-with-notice (no existence oracle).
- Self-service profile update is schema-whitelisted (name/phone/company/country/city/address/website) — no `passwordHash`/`status`/`tokenVersion` injection despite the service's `data: any` (`route auth.ts:27-35` guards it).

### P3-2 🟡 No "log out everywhere" for customers
- `revokeSessions` exists, but only logout/logout flows trigger it. A customer who lost a device has no self-service way to end all sessions (`ProfileEdit` has no such control — pending visual check). Add a tiny "sign out of all devices" endpoint + button.

### P3-3 🔵 `generateToken`/`generateRefreshToken` in `middleware/auth.ts:258-268` are dead code
- Token generation lives in `authService.ts`; these copies lack `tv` and have no callers. Delete before somebody wires them in and mints revocation-proof tokens.

### P3-4 🟡 `/auth/refresh` + `/admin/auth/refresh` have no dedicated rate limiter
- Login/register/reset get their own limiters; refresh rides the general 100/min public and 300/min admin limits only. Practical risk is log-noise + a DB round-trip per guess; cheap to harden, low priority.

---

## P4 — Catalog + inquiries ✅ (2026-10-29)

### P4-1 🟠 Full-text search never uses its own index; description/identifier columns are barrel-scanned
- `searchService.fullTextSearch` (`searchService.ts:26-50`) probes **11 columns** with Prisma `contains` (→ `ILIKE '%q%'`): name, sku, description, seoKeywords, manufacturer, modelNumber, mpn, impaCode, gtin, brand.name, category.name. `mode: 'insensitive'` allocates an unanchored `ILIKE` per column per row.
- Migration `20260727000002_add_fulltext_search` created: (a) a GIN `tsvector` **expression index** on `to_tsvector('english', name || ' ' || description)`; (b) trigram GIN indexes on `products.name`, `products.sku`, `brands.name`, `categories.name`.
- Verdict: **(a) is dead** — grep across `backend/src` finds zero `tsvector/tsquery/trgm` usage; no query reproduces the expression, so Postgres can never match it. **(b) genuinely helps** the name/sku/brand/category probes, but `description`, `seoKeywords`, `manufacturer`, `modelNumber`, `mpn`, `impaCode`, `gtin` have no index → sequential scan per search. The storefront products-page search (`productQueries.ts:193-199`) only probes name/sku/brand.name, which IS trgm-covered.
- Impact: `/api/search` (the Ctrl+K palette + Search page path) degrades linearly with catalog size, and the headline "full-text search" feature of the migration simply doesn't work. Either wire `websearch_to_tsquery`/`pg_trgm.similarity` into `fullTextSearch` (using `idx_products_fts`) or add trgm indexes for the identifier columns and drop the dead tsvector index. 🟠 because search is the primary finding UX in a parts catalog.
- ✅ Right side: result shape is good (slug paths, main-image join, brand/category fallbacks, take-20 cap); both frontend consumers (`Search.tsx`, `CommandSearch.tsx`) handle API failure gracefully.

### P4-2 🟡 Search results compute a sale-window-blind price — which the frontend never reads either
- `searchService.ts:73`: `price: p.salePrice < p.regularPrice ? p.salePrice : p.regularPrice` — ignores `saleStartsAt/saleEndsAt`, breaking the invariant kept everywhere else via `getEffectivePrice` (`productQueries.ts`, `merchantFeedService.ts:119-120`, settings-driven pricing).
- Double-dead: neither frontend consumer renders the field (`Search.tsx:88-106` and `CommandSearch.tsx:49-61` only map id/type/title/description/slug/path). So today it is an invisible inconsistency; the moment a third party consumes the search API (mobile app, feed, affiliate), it would display expired/future sale prices.
- Fix: use `getEffectivePrice(p)` in one line; optionally drop the field entirely if truly unused.

### P4-3 🟡 Standard RFQs get `responseDeadline = null` while the UI promises "response in 4 hours"
- `rfqService.createRfq` (`rfqService.ts:48-52`): emergency → +2h, urgent → +24h, **standard → null**. The client SLA module (`rfqSla.ts:8`) declares standard = **4h**, and the RFQ success screen shows a live countdown built from it (`RFQ.tsx:128`).
- Consequences: (a) the advertised 4-hour response for the *majority* of RFQs can never be tracked or audited server-side; (b) the dashboard's overdue logic (`dashboardService.ts:205: responseDeadline: { lt: now }`) structurally skips every standard RFQ — "overdue RFQs" can never fire for most inquiries; (c) combined with P1's `firstResponseAt` never written, the entire response-SLA ledger for standard RFQs is dead in the DB while marketing copy flashes a countdown.
- Fix: stamp standard deadline (4h per `rfqSla.ts` — or make the copy/data the same constant), write `firstResponseAt` on admin respond, and let `dashboardService.overdueRfqs`/feed admin emails see all urgencies.

### P4-4 🟡 RFQ `consentAt` is never recorded for the primary funnel; the emergency form fabricates consent
- `routes/storefront/rfq.ts:25-27` accepts `consentAt` ("Recorded with the request so the agreement has a timestamp") and `rfqService.createRfq:46` writes it **only when the client sends it**. The RFQ page (`RFQ.tsx:105-121`) never sends it → the consent timestamp stays null for normal RFQs; only the boolean `consent: true` (forced by Zod refine) is stored. A checkbox click leaves no timestamp trail.
- `contactService.submitEmergencyRequest:53` hardcodes `consent: true` for the auto-created emergency RFQ — no prompt, no timestamp, no checkbox (the form has none). Defensible as an operational request, but then it shouldn't be stored as *customer* consent.
- Fix: server-stamp `consentAt: new Date()` when `consent === true` (server time is the auditable fact); for emergency, either omit the consent flag or store it under an explicit `operationalRequest: true` semantic.

### P4-5 🔵 Inquiry funnels lack the offers-style flood/abuse budgets
- Offers got a dedicated treatment (G47): `submitOfferLimiter` 8/10 min (`offers.ts:26-32`) + per-email open-offer ceiling + normalized-email 24h budget + IP breaker (`offerService.ts:79-94`).
- RFQ, contact, and emergency submissions ride only the global public limiter (`server.ts:217`), yet each RFQ insert also queues an admin email (`sendRfqReceived`), and each emergency submit creates an `EmergencyRequest` + `Rfq` row + `sendEmergencyAlert`. Repeated emergency spam = email flood. Cheap fix: apply the same pattern (per-email + per-IP 24h counts) in `createRfq`/`submitEmergencyRequest`.

### P4-6 🔵 Dead provisional ID generators (this supersedes P2F-2)
- `generateOrderId` (`useStore.ts:548`): **zero consumers** — pure dead code.
- `generateRfqId` (`useStore.ts:323`): one consumer — `RFQ.tsx:126` as fallback when the submit response lacks `rfqNumber`. But the backend **always** returns it (`routes/storefront/rfq.ts:34-38` sends `rfqNumber: rfq.rfqNumber` unconditionally; same for `/contact/emergency`). So the fallback is dead under the current contract, but if the contract ever drifts the page would happily display a client-fabricated `AT-XXXXX` number that does not exist in the DB — a support-desk trap ("why can't you find my RFQ AT-7734?").
- Recommendation: delete `generateOrderId` + `offerJustSubmitted` now; for `generateRfqId`, prefer failing loudly ("quote number unavailable — check your email") over printing a fake one.

### P4-7 🔵 Dead state: `offerJustSubmitted`
- Defined in the store (`useStore.ts:111,552`), only ever *cleared* (`MyOffers.tsx:51`), set nowhere, read nowhere. Remove the field and the cleanup effect.

### P4-8 🔵 Listing-page cosmetic gaps / content coupling
- Active filter chips omit price and industry filters (`Products.tsx:295-297`): a price filter or industry selection is applied but invisible in the chip row (only "Clear all" covers it).
- `Products.tsx:296` `seoQueryLabel` uses the raw **brand slug** (`selectedBrands[0]`) in the SEO title — "bosch-rexroth" instead of "Bosch Rexroth" in `<title>` for brand facets. Cosmetic.
- Home tiles hard-code category slugs (`Home.tsx:27-34`: `engine-spare`, `marine-pumps`, `electrical`, `hydraulic`) and search-chip hrefs. Any category rename/deletion leaves marketing tiles pointing at an empty catalog —no code bug, but an admin needs to know these are coupled to DB slugs.

### P4-9 🔵 Offer checkout summary shows unit amounts but multiplies savings
- `OfferCheckout.tsx:342-349`: "Listed price" and "Accepted offer" rows show **unit** values while "You save" shows `savings * qty`. For qty > 1 the math visibly disagrees with itself (charge is fine — the server prices the order). Add ×qty to the two rows for consistency; `MyOffers.tsx:173` already shows `unit * qty`.

### P4-10 🔁 P1 refinement: `site.phoneNumber` is doubly dead
- Admin Settings still accepts `site.phoneNumber` as a writable key (`settingsService.ts:23`), but `getPublicSettings` whitelists only `site.phone` (`settingsService.ts:120-131`), and the consumer reads `site.phone || site.phoneNumber` (`useStoreSettings.ts:184`). So a legacy-row edit can never reach the storefront, and any admin who edits the "phoneNumber" field sees nothing change. Ignore-or-drop the key in `SETTING_KEYS` explicitly.

### P4-11 ✅ Verified good (catalog + inquiry wiring)
- **Pricing display consistency:** every storefront query path returns the date-aware effective price (`getEffectivePrice`) — listing (`productQueries.ts:147-267`), detail (`280`), related (`328`), price bounds SQL matches the same rule (`productQueries.ts:382-394`), merchant feed uses `isOnSale/getEffectivePrice`, and the client adapter (`adapters.ts:66-74`) re-derives identical window-aware logic, so cart-page, detail-page and grid prices always agree.
- **Faceted listing page:** URL is the single source of truth with compare-and-set hydration (`Products.tsx:165-191`), out-of-range page clamped back (122-129), junk-facet combos noindexed with per-facet canonicals (304-317, B18), sort/price-sort handled server-side, honest API-down states with zero demo-catalog leakage, and the sidebar fed from the API's deduped `getFilterCounts` payload with real bounds.
- **Product detail**: stock-gated CTAs, quantity clamped to stockCount, sticky bar lifecycle handled without hook-order violations, hidden category/brand hubs never linked while names still render, sale % off computed against real original price, WhatsApp/RFQ escape hatches for every "can't buy" state.
- **Search UX**: debounced + race-guarded in both the modal and page; recent-searches persisted.
- **Offer flow end-to-end** (verified by reading route, service, and all four frontend pages/components): input-only amount with server-side eligibility + sanity floor, normalized-email abuse budgets, IDOR guards on every offer read/pay/accept, lazily expired payment windows, accepted-counter window restarts from acceptance, server-authoritative order creation with unique-FK idempotency + race-claim + compensation rollback, PayPal-gate before the awaiting-payment flip, both PayPal paths mark the offer paid idempotently, full-refund restores claimed stock.
- **Shipping/payment surfaces on pages match the server's rules** (shipping promise built from the same zones/threshold settings the checkout charges; payment-method radios hidden when admin hasn't made them payable).
- **RFQ/Emergency/Contact pages**: draft persistence, honest errors, correct submit payloads; emergency creates linked emergency RFQ + audit entry + 2h deadline; RFQ notification prefs honored per admin toggle.
- **Data hygiene**: `source` clamped to the 50-char column before insert (`rfqService.ts:36-39`); slug-history 301s for categories/brands/industries/products with hidden-hub honesty; search filters capped with `take`.


## P5 — ADMIN CONSOLE findings ✅ (2026-10-29)

**Overall: this is the strongest subsystem in the repo.** Every page is routed (`App.tsx:247-264`), every page hits a real endpoint that exists, server-side pagination/filtering is used consistently, optimistic updates have real rollbacks, and several flows (publish verification, media usage guard, eBay import lifecycle) are better than the storefront's brand promises. The findings are the residue.

### P5-1 🟠 Customer `cancelRequested` is invisible to every admin surface (cross-ref P2-1, P2-5)
- Evidence: `Order` type (`orders/types.ts`) and `mapApiOrder` carry no `cancelRequested` field; `OrderTable.tsx` and `OrderDetailSlideOver.tsx` render status/payment/tracking but never the flag; `OrderFilters.tsx` has no "cancellation requested" tab (status tabs come from server `statusCounts`, which count `status`, not the flag). The only trace is inside the order timeline (`OrderDetailSlideOver` history rows).
- Impact: the admin queue answers orders top-down; a customer-requested cancellation looks identical to a normal pending order. Combined with P2-1 (customer already emailed "has been cancelled"), the store can ship an order the customer believes is dead — duplicate shipment, chargeback-grade complaint path.
- Fix: surface the flag as a row badge + a dedicated filter tab (server `statusCounts` should include `cancelRequested` count), and make the ship action warn when the flag is set.

### P5-2 🟡 The admin console hard-codes `$`/"(USD)" while `site.currency` is configurable
- Evidence: `OrderTable.tsx:63`; `OrderDetailSlideOver.tsx:141-162` (totals/lines); `AdminRFQs.tsx:594,633` ("Offered/Unit Price (USD)"); `AdminOffers.tsx:184,469-476,586-594,635-637` (analytics + table + counter modal); `AdminCustomers.tsx:147-148,237` (revenue stats + table); `AdminProductTable.tsx:246-250` (price cells); `ShippingTab.tsx:50,54,83-87` ("Flat Rate ($)").
- Impact: set `site.currency` to EUR and every admin screen mislabels money. Quotes sent from the RFQ drawer ("Unit Price (USD)" on an offer creation) are the worst case: the offer/checkout math resolves in the real settlement currency, but the number the admin types is labeled with a currency that may be wrong. Ordering mistakes are plausible, not cosmetic.
- Fix: read `currency` from `useStoreSettings()` (already available) and format via `Intl.NumberFormat` with the currency option; zones' currency label should follow the same setting.

### P5-3 🟡 RFQ urgency tab badges count only the currently loaded page
- Evidence: `AdminRFQs.tsx:365` computes badges as `rfqs.filter(r => r.urgency === u).length` over the fetched page, unlike Orders/Customers/Offers/Messages badges which use server-computed `statusCounts`.
- Impact: with 50-item pages and 300 tier-2 RFQs, the "Urgent (0)" badge shows zero until that page happens to contain urgent rows; urgent RFQs (the exact ones P1-3 demotes to the bottom of the sorted list) can be missed *twice over*: sorted last and badge-hidden.
- Fix: return `urgencyCounts` from the same aggregate query that produces `statusCounts` and mirror the Orders pattern.

### P5-4 🟠 "Send Invite" sends nothing: temp password via `Math.random()`, shown once in a toast, and there is no password reset path in the UI
- Evidence: `AdminUsers.tsx:155-173` — `handleInvite` invents a password client-side from two `Math.random()` strings (not crypto-random), posts it to `POST /admin/users` (`routes/admin/users.ts:26-32`), then surfaces it **only** as a toast: *"Share the temporary password securely: {password}"*. No email is sent (the `Mail` icon is decoration). The table/row actions (`AdminUsers.tsx:262-267`) offer only view / edit-role / deactivate — no "set password", even though the backend supports it (`PUT /admin/users/:id` takes an optional `password`, `users.ts:34-49`). `AdminLogin.tsx` has no forgot-password link; admin auth offers login only.
- Impact: (a) password entropy from `Math.random()` is predictable-swarm-weak; (b) if the admin misclicks the toast, the account is **unrecoverable through the UI** — the owner must call the API by hand or touch the DB; (c) the invited user is never forced to rotate on first login (`createUser` sets no must-change flag, and the password-change endpoint isn't exposed anywhere), so a temp password can live permanently.
- Fix: generate with `crypto.getRandomValues`, either email the credentials via the existing email-queue infra or show them in a modal with copy-once semantics, add a "Reset password" action per row (wired to the existing PUT), and (nice-to-have) force-rotate on first login.

### P5-5 🟡 Payments tab PayPal fields are cosmetic: the backend ignores them entirely
- Evidence: `PaymentsTab.tsx:61-72` lets an owner enter `clientId` and flip `sandbox`/`live` (`testMode`) for PayPal, and `AdminSettings.tsx:120-122` persists it all as `store.paymentMethods` JSON. But `getPublicSettings` strips `config` before publishing (`settingsService.ts:139-144`), and PayPal is configured **env-only**: `PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET` (`backend/src/utils/paypal.ts:5`), with a one-time startup warning when missing (`server.ts:52-53`). Grep for `clientId` consumers in backend → zero real readers (only a test fixture, `bankDetails.test.ts:70`). The mode toggle changes nothing (PayPal base URL is env-driven too).
- Impact: an owner following the UI will believe PayPal is wired when it isn't (env vars), or click "Live Mode" expecting real charges. Contrast: the bank-transfer and L/C fields in the *same* modal **are** consumed (`bankDetailsService.ts:50-81`), which makes the PayPal dead fields look more legitimate, not less.
- Fix: mark the PayPal config block "managed by environment (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)" with the current live/sandbox state from the server config endpoint, or actually feed `config.clientId`/`config.mode` into `paypal.ts` (prefer removing the inputs).

### P5-6 🔵 Shipping-zone `rateType` is a one-way door: UI can only ever create `flat` zones
- Evidence: `ShippingTab.tsx:161-169` hard-codes `rateType: 'flat'` on create; the edit panel (75-107) exposes no rate-type control; yet the type (144) and the display (`46`, "Rate: Flat Rate / Weight-Based / Free Shipping") model all three, and the zone parser (`useStoreSettings.ts:113`, backend `utils/shipping.ts`) accepts all three.
- Impact: `weight`/`free` zones are reachable only through pre-seeded data or JSON edits; worse, the display shows `$${zone.flatRate}` even when `rateType` is `free`/`weight`, mislabeling legacy rows. Not a live defect if all zones start `flat` — a trap for the future.
- Fix: either add a rate-type selector + weight-rate field, or drop the unused types from the type/parser so data and UI agree.

### P5-7 🔵 Admin Insights: analytics run on sampled datasets, and one dataset is fetched but never used
- Evidence: `useDashboardData.ts:40-102` caps collection at orders 200 / RFQs 100 / offers 100 / products 500 / **customers 200** via `collectPages`, documented as an endpoint-clamp workaround; `AdminInsights.tsx:63` destructures `{ stats, alerts, orders, rfqs, products, customers }` — the hook's `offers` array is fetched (a whole extra API lift) and never consumed by the page.
- Impact: every panel computing absolute numbers over these arrays (RevenuePulse money math, ReturnAnalytics, FraudDetectionCenter) silently reports over "latest ~200 orders", not all-time; with capped samples, totals and trends drift as the store grows. Also the unused `offers` fetch is wasted payload on every Insights load.
- Fix: either annotate panels with "sampled" wording and move revenue aggregates to the server `dashboard.stats` (already computed there), or raise caps; drop the dead offers fetch.

### P5-8 🔵 `store.notifications.lowStockThreshold` is stored but nothing reads it — not even the tab that owns it
- Evidence: `settings/types.ts:49` (`lowStockThreshold: 10` default) is saved into the blob (`AdminSettings.tsx:97,122`); `NotificationsTab.tsx` renders no threshold field; the actual low-stock scan uses **per-product** thresholds (`adminNotifications.ts:107-113` raw SQL `stock_count <= low_stock_threshold`).
- Impact: dead config field; a future maintainer might "fix spam" by lowering it and change nothing.
- Fix: remove the field (or expose it as the fallback threshold when a product's own is unset — a behavior decision).

### P5-9 🔵 Sidebar role-hiding ≠ route guarding; a hidden page renders then errors
- Evidence: `AdminSidebar.tsx:89-100` hides Users/Audit-Log from non-owners and Settings from non-store-managers, but `AdminGuard` (`AdminGuard.tsx:8-30`) checks only "is logged in"; backend enforces roles per route (`users.ts` `requireOwner`, `settings.ts:12` `requireReadAccess`).
- Impact: a sales-agent pasting `/admin/users` gets the page shell with empty data plus error toasts per request. Not a security hole (server is the boundary); it's a UX honesty gap only.
- Fix: optional client-side `RequireRole` wrapper to render a "no access" plate instead of error salad.

### P5-10 🔵 Admin Messages attachment UI renders a paperclip for a field that can never be populated
- Evidence: `AdminMessages.tsx:55` builds messages with `attachments: []` always; rows show `<Paperclip …>` only when `attachments.length > 0` (`391`) and the detail slideover lists "Attachments" (`435-439`) — the backend stores no attachments for contact messages (the `attachments` payload is a dead key, `tests`/`messageService` read none).
- Impact: pure spec UI. Remove the rows or wire attachment storage through the media service if the contact form is ever going to accept files.

### P5-11 ⊛ Correction to P4-10 / P1-9 (phone number): the storefront phone **does** work — only the legacy key is dead
- Verified flow: Admin Settings saves `site.phone` (`AdminSettings.tsx:20,17-31`) → included in the public whitelist (`settingsService.ts:121`) → `useStoreSettings.ts:182-184` maps `s['site.phone'] || s['site.phoneNumber']` into the `phoneNumber` the Navbar (`Navbar.tsx:206,252`), Footer (`Footer.tsx:85`) and Emergency page consume. What remains true from P1-9/P4-10 is only the cleanup: `site.phoneNumber` is still accepted as a writable `SETTING_KEYS` entry (`settingsService.ts:23`) but no admin surface writes it and only the legacy fallback reads it — drop it from the whitelist.

### P5-12 ✅ Verified good (admin console, for the record)
- **Orientation/jump logic**: dashboard alert → admin-route mapping is a deliberate curated table, not `${entityType}s` guessing, explicitly fixed for dead links (`AdminDashboard.tsx:31-51` with the bug comment); and every one of the `?filter=out-of-stock|missing-images|low-stock` deep links is actually parsed by AdminProducts (`AdminProducts.tsx:19-131`, `STOCK_FILTERS`).
- **Server-first discipline**: Orders/Customers/Media/Messages/Offers/Audit all filter+paginate server-side with de-duplicated client passes; Audit's "don't re-filter server results" comment (`AdminAuditLog.tsx:164-167`) documents a real past bug.
- **Publish verification**: after publishing, the product form fetches its own public URL and validates canonical, `Product` JSON-LD and `<h1>` match, with 3 retries and a visible pass/fail verdict (`useProductForm.ts:604-629`) — an adult-level pipeline triple-check.
- **Settings integrity**: unknown keys rejected with an error instead of heroically ignored (`settingsService.ts:237-244` "a silently-ignored typo means the admin thinks they changed the tax rate"), streaming write is per-key upsert with audit logging; read-only roles get a disabled fieldset (`AdminSettings.tsx:193`).
- **Media life-cycle**: upload type/20MB limits enforced at `multer` (20MB is what the UI promises too, `media.ts:29-37` against `AdminMedia.tsx:260`), SHA-256 dedupe (`uploadMedia`), eBay-only host allowlist for remote mirroring (explicit SSRF guard), and `deleteMedia` refuses to delete anything in use across product images (URL-or-assetId), brand logos, admin avatars, OG images (`mediaService.ts:247-268`), with Cloudinary destroy treated as best-effort (idempotent + warn).
- **Users**: bitterly important guards all present — no self-deactivation in two different code paths (`userService.ts:40-41,61`), session revocation on password change/reactivation/deactivation (`54,64`), full audit logging on every mutation, and an owner-only route wall.
- **eBay inventory panel**: full lifecycle — resumable import (polls, restart-safe pickup of a running job from before page-load/deploy `AdminEbayInventory.tsx:118-158`), cancelable, drift-sync button with honest counts (`synced/failed/driftFound/ordersPolled`), marketplace multi-listing rows with `rowSpan` correct columns, per-listing last sync time and last error tooltip. The import docstring quietly includes two filtration guarantees the storefront relies upon (existing SKUs linked, drafts not auto-published).
- **Notifications wiring**: `store.notifications` toggles gate real emails; a scheduler (`notificationScheduler.ts`, fixed `setInterval` + persisted "last sent" state in `store_setting`) drives daily low-stock digests and weekly/monthly reports that only advance their clock when the digest is durably queued (`adminNotifications.ts:128-135,189-195` — exactly the right durability pattern). `reportEmail` is honored (`72-81`).
- **Taxonomy pages**: header-honest SEO gates per category/brand/industry recalced from the same server rule (`getHubSeoIssues`), slug-rename warnings ("this changes the live URL… 301" `AdminCategories.tsx:387-391`; industries correctly announce there is *no* standalone URL yet, `AdminIndustries.tsx:578-580`), optimistic visibility toggles with exact-scope rollback, correct sibling-swap reorder writes (`AdminCategories.tsx:201-227`).
- **Cross-role honesty**: role enum mirrored from code, permissions matrix rendered from the same keys, and Settings becomes visibly read-only for non-store-manager roles with no save action.


## P6 — CROSS-CUTTING findings ✅ (2026-10-29)

**Scope:** i18n/locale boot, translation packs, hreflang/canonical/SEO head, PWA + service worker, HTTP response cache middleware, email templates + senders, executable mail routes (wording vs. reality), cart-store lifecycles and stale-UI windows, eBay inventory mirror end-to-end, CSV exports, admin session hygiene, dead code across layers.

### P6-1 🟠 Email templates render several user-supplied values **without** `escapeHtml` — a phishing-grade HTML-injection surface
- Evidence (raw, unescaped slots inside otherwise-escaped templates):
  - `rfqResponse`: `emailTemplates.ts:200` — `Hi ${data.customerName}` and `${data.rfqNumber}` rendered raw in the greeting (customerName is attacker-supplied free text at RFQ creation; the same template *does* escape `data.message` on :201).
  - `offerReceived`: `:229` — `${data.productName}` and `infoRow('Customer', data.customerEmail)` raw.
  - `offerDecision`: `:242` + `:245` — `${data.productName}` twice, raw.
  - `welcome`: `:275` — `Hi ${data.name}` raw (name is customer-supplied at register).
  - `passwordReset`: `:265` — `Hi ${data.name}` raw (looks up an arbitrary submitted email/name).
  - Contrast proving it's a lapse, not policy: identical templates escape everything else (`contactNotification:254-256`, `emergencyAlert:208-216`, `adminOrderEvent:302`, `orderConfirmation:119`, and even `rfqReceived:190` which escapes the same `customerName` that `rfqResponse` leaves raw). Senders (`emailSenders.ts`) pipe raw DB values straight into the templates.
- Impact: email clients strip scripts, so this is not stored XSS in the app — but it **is** arbitrary HTML injection into a customer-facing email: attacker-named bold text, links, or `<img>` labels can spoof "your RFQ X has been accepted / offer confirmed" content and embed invisible tracking pixels. One bold field in a trusted-brand email is a canned reply that customer service will believe. Resend is called via HTTP API (no SMTP header-injection path), which caps severity at email-content spoofing — still 🟠.
- Fix: wrap every dynamic slot in `escapeHtml` (one pass over the 5 templates), including the `Offer`/`Product` infoRows; add the two subject lines (`rfqReceived:194`, `emergencyAlert:221`) to a plain-text sweep for sanity.

### P6-2 🟡 The cancellation lifecycle has exactly ONE email template — and that template says "has been cancelled" — so request and decision are indistinguishable, and no email ever mentions a refund
- Evidence: `emailTemplates.ts:172-182` is the only cancellation template ("your order … **has been cancelled**"); it is sent from *three* call sites: the customer's **request** (`orderMutations.ts:524-528`), the admin manual cancel (`:702`), and the cancel-inside-status-update path (`:625`). No "request received — pending review" template exists. Meanwhile the two paths that actually cancel run `restoreStockAndRefund`/`releaseOrderReservation` (`:602-611`, `:691-695`) — and the email says nothing about whether money is being returned (template body = order number + reason + contactUs line only).
- Impact: (a) this is the template half of P2-1's 🔴 lying email — there is no honest wording available in the codebase even if the caller wanted it; (b) the customer gets **two identical** "cancelled" mails (request + decision), which after-the-fact looks like a resend bug; (c) a paid PayPal order that was cancelled + auto-refunded never tells the customer a refund happened either — the refund may surface days later as an unexplained line item.
- Fix: add a `cancellationRequested` template ("we've received your request… our team will confirm"), keep `orderCancelled` for the decision, and when a payment refund executes, include the refund status (amount, ETA) in the cancelled email — the refund result object is already in scope at `restoreStockAndRefund`.

### P6-3 🟡 `adminReport` emails hard-code `$` while every other money email is currency-aware (cross-ref P5-2)
- Evidence: `emailTemplates.ts:349` `${p.revenue.toFixed(2)}` prefixed with a literal `$`, and `:356` same for the revenue total — versus `orderConfirmation:96-97`, `orderPaymentReceived:146-148`, `offerReceived:225`, `offerDecision:238` which all use `Intl.NumberFormat`/`formatMoney` with the order's real currency.
- Impact: the weekly/monthly report answers "how much did we sell?" with a currency label that may not exist. Same trauma class as P5-2 and trivial to fix — but note the *sender* doesn't know the currency either (`emailSenders.ts:131-138` has no currency param): `adminNotifications.ts` resolves recipients from settings, so it can pass `site.currency` through.
- Fix: add `currency` to the adminReport template data and use `formatMoney(revenue, currency)`.

### P6-4 🟡 Admin logout does NOT clear the react-query cache — the next login on the same browser can read the previous admin's data
- Evidence: customer logout deliberately wipes client caches (`useStore.ts:396-398`, `queryClient.clear()` with the comment "Customer-scoped caches (orders, offers) must not survive the session"); `adminLogout` (`useStore.ts:223-228`) clears only the token + marker. Admin pages fetch through `useApiQuery.ts` (react-query) with global `staleTime: 5 min`, `refetchOnWindowFocus: false` (`queryClient.ts:10-13`).
- Impact: on a shared terminal, admin B logging in within the stale window gets admin A's mounted query keys served **from cache without any refetch** — a viewer-role user can see owner-data pages for up to 5 minutes with zero server authorization of that read. Same-tenant only (server is the real boundary per P5-9), but it is exactly the session-hygiene gap the customer side already guards against — the asymmetry is the bug.
- Fix: `queryClient.clear()` in `adminLogout` (one line, symmetric with customer logout).

### P6-5 🔵 `/admin` boots with a browser-derived `<html lang dir>`: an Arabic-browser admin gets an RTL console in English
- Evidence: `main.tsx:49-54` sets `lang/dir` from `navigator.language` whenever the path isn't under a valid `/:locale` — `/admin` and `/admin/login` qualify. No admin component ever corrects it (the only `documentElement.dir` writers in `src` are `App.tsx:109` locale layout, `useStore.ts:274` setLanguage, and `main.tsx:53`; admin pages import no `react-i18next` at all — they're hard-English). So an Arabic (or Spanish) browser lands on `lang="ar" dir="rtl"` wrapping an English-only, LTR-designed panel.
- Impact: cosmetic/a11y mismatch only (admin is noindexed, no SEO touch; no data risk). But "my whole admin panel is mysteriously flipped" is a support-ticket generator for Gulf-based owners.
- Fix: one effect in `AdminLayout` pinning `document.documentElement.lang='en'; dir='ltr'` (mirroring the LocaleLayout effect).

### P6-6 🔵 eBay autosync rewrites "central truth" `stockCount` with no persistent stock-movement trail — because no inventory ledger exists anywhere
- Evidence: `ebayCatalogAutoSync.ts:315-334` direct `prisma.product.update` on `stockCount` (documented, condition-guarded ownership rule: eBay's own quantity change beats the mirror), plus availability flips at `:246-248` / `:266-268`. Nothing else in the system writes stocks outside `centralInventory.ts` — but `centralInventory` itself only *logs* (`syncAvailabilityFlag`; no movement table; grep shows the schema has no ledger model, and `schema.prisma:702` says the flat mapping "Central inventory lives on products.stockCount" is the design). Server-side pino logs are the only trace, and pino-rotated logs are ephemeral.
- Impact: an owner can reconstruct stock changes from orders, but changes caused by eBay import sweeps (or a cancelled order comp) have **no queryable after-the-fact record** — "why is stock 3 now?" is unanswerable a week later. Races are handled (ownership guard requires `status==='synced'` and equal-state checks; the drift reconcile `ebaySyncScheduler.ts:119-147` self-heals residuals), so the behavior is deliberate and defensible — the gap is *observability*, not correctness.
- Fix (optional): audit-log each autosync stock/price change via the existing `logAudit` infra (actor = 'ebay-autosync'), or insert a lightweight `stock_events` row.
- Cross-ref: P1-6 (retention/cleanup jobs absent) is the sibling finding — growth without pruning + growth without ledgers are both "we won't know what happened" classes.

### P6-7 🔵 Cart prices refresh only on full page load; a long-lived tab can sit on stale prices forever
- Evidence: `App.tsx:206-211` — `refreshCartPrices()` runs exactly once on boot; the `visibilitychange` handler (`:198-204`) only pings the DB wake endpoint and never refreshes the cart; no component calls it later (grep: 5 hits total, all in App.tsx + the store definition).
- Impact: a tab kept open for days shows pre-sale/pre-price-hike totals in drawer + checkout review; the server re-prices at order creation (P2-6 verified), so money can't be wrong — but the *displayed* expectation can disagree with the *charged* total and the 409-unavailable-line path only catches stock-outs, not price drift. One extra `storefront.products.list` is also paid on every boot even for 1-item carts (perf nit — better: per-id get when cart is small).
- Fix: on `visibilityState === 'visible'` regain (throttled), or before entering checkout step 2, call `refreshCartPrices()`.

### P6-8 🔵 Dead-code sweep extension (continues P4-6/P4-7): `src/hooks/useProducts.ts` has zero consumers
- Evidence: defined at `useProducts.ts:5` (~100 lines of store-filter client-side filtering: categories/brands/industry/price/onSale/urgency/sort over a passed product array). Grep across `src` finds no import or call — the only hit is its own definition. The storefront has been server-side+URL-driven since the P4 rewrite (`Products.tsx` P4-8/P4-11), making the hook leftover.
- Fix: delete the file with the other dead IDs (`generateOrderId`, `offerJustSubmitted`, `middleware/auth.ts:258-268` token generators). As always with this audit: no code changed — recommendation only.

### P6-9 ✅ Verified good (cross-cutting, for the record)
- **i18n boot is URL-authoritative and flash-free:** `main.tsx:46-73` sets `<html lang/dir>` synchronously before React mounts and boots i18n in the same URL locale (the stale-shell layout-shift comment documents the bug they fixed); `LocaleLayout` re-syncs on every locale change (`App.tsx:106-113`); legacy un-prefixed URLs redirect with query preserved (`:118-120`); fallback `en` covers any runtime gap. The store's `language` is derived state, not persisted state — no desync trap.
- **Translation packs are complete:** script-verified parity — en/ar/es all carry exactly **684 keys**, zero missing, zero extra, zero type mismatches (`src/locales/*.json`); and they're genuinely translated, not copy-dumped (AR: 4 / ES: 10 values identical to EN across 684 — brand names and URL-like strings).
- **Hreflang + canonical (old-audit S6 = FIXED):** `SEO.tsx:46-61` emits alternates only for routes with verified translations per `shared/route-i18n.mjs`, always with `x-default → /en`; untranslated locale variants are `noindex, follow` (`:286`); canonical is always absolute and locale-prefixed to the *served* URL (`:141-145`); the old `og:image` double-prefix bug is fixed with explicit absolute-URL handling (`:150-155`); product `og:type` meta + no duplicated Product JSON-LD when the page supplies richer schema (`:233-236`).
- **`cacheGet` is safe and actually serviced:** whitelist is tight — only static public storefront reads (`cacheGet.ts:17-22`); auth/CSRF-header requests bypass; only 2xx body+status cached (`:57-59`); `invalidateCachePath` strips query strings so every URL variant busts (`:80-88`); and every mutation path of the cached sets really calls it — `brandService.ts:108,134,148` (+ brandLogo), `categoryService.ts:127,179,194,201`, `industryService.ts:91,117,131`, `settingsService.ts:283` (maintenance mode included). CSRF tokens attach only to mutations (`api/core.ts:253-257`), so app GETs benefit from the cache; `verifyCsrf` mounts before the cache middleware (`server.ts:250` vs `:385`) so there's no order trap.
- **PWA/service worker defuses the stale-shell trap:** HTML is deliberately never precached, `navigateFallback` is nulled and navigations are NetworkFirst with 5s timeout + 32-entry/7-day expiration (`vite.config.ts:56-107`, with a lucid post-mortem comment for the old white-screen behavior); precache is hashed assets only (fonts/js/css) so deploys never self-destruct lazy chunks; the build refuses secret-shaped `VITE_*` vars (`:16-24`); SW registration is `script-defer` + autoUpdate. Nit used later in P7: manifest ships a single 400×400 icon (no 192/512 or maskable variants — installability threshold is met but add-to-homescreen polish is thin).
- **eBay inventory mirror is wired end-to-end:** every stock mutation path routes through `centralInventory` — `decreaseStock`/`increaseStock`/`reserveStock`/`releaseReservation`/`setStock` (`centralInventory.ts:55-265`) — and *all of them* enqueue mirror sync + fire the near-real-time kick (`:95,130,188,221,275-290`); the scheduler runs poll/push/reconcile/retry nets (`ebaySyncScheduler.ts`), central stock is never rolled back on eBay failure (`:104`), archived products end the relationship (`:69-76`), and the admin product form routes stock edits through `setStock` with an honest 409 when another sale raced it (`productMutations.ts:282-311`). This resolves the pending-lead question: **yes, website orders (and refunds) propagate to eBay quantities** within seconds (kick) or ≤10 min (sweep), whichever survives.
- **CSV exports re-verified:** `exportOrdersCsv` (`orderQueries.ts:157-162`) confirmed as thin as P1-7 filed (5 columns) — and now also note the silent `take: 10000` cap with no truncation marker; `exportProductsCsv` (`productImportExport.ts:61-89`) properly full-snapshot with quote-escaping (formula-injection only reachable from admin-entered SKUs/names — acceptable, keep in mind when P1-7's rework adds customer columns).
- **Customer-side store hygiene:** logout wipes the cart and every checkout remnant including `orderPlaced`/`cancelRequested`/`orderSummary` (`useStore.ts:387-399`) — no cross-account confirmation leakage; cart quantity clamps exist at every write path (`addToCart:441-461`, `updateQuantity:468-482`, `refreshCartPrices:521-529`), and the persisted cart is re-validated against live products with per-id fetch fallback for dropped list entries (`:490-538`).


## P7 — SYNTHESIS ✅ (2026-10-29)

**Counting everything P1→P6 (excluding ✅ verified-good and ⊛/🔁 correction entries):** 🔴 1 · 🐛 1 · 🟠 7 (P2-5 🟠 is folded into P5-1, which confirmed it) · 🟡 17 · 🔵 17-ish — across ~50 actual findings for a codebase of this surface area. For calibration: a typical mid-size store audit of this depth produces the same *volume*, but not usually with **one red**. The severity distribution is lopsided toward yellow/blue — meaning most issues are weak-wording, hygiene, or future traps, not broken money.

### The verdict (answering the founding question)

> *"Is this a complete e-commerce site, wired up end-to-end everywhere, or are there broken/missing/incomplete flows?"*

**Yes on the spine — it is a real, complete e-commerce with an unusually disciplined money path. The bus is wired from bumper to bumper. What remains broken is not wiring — it is mostly *words promising what the data doesn't say*: emails, badges, labels and promises that drift from what the system actually does.**

The full money loop was verified end-to-end by reading every stage:
cart (clamped, price-refreshed) → checkout (stale-fingerprint invalidate, idempotency keys, 409 unavailable-line honest handling) → server-authoritative totals (client never posts money) → payment (PayPal capture verifies the captured amount, auto-refunds on mismatch, race-safe against the webhook; bank/LC reserve stock at placement with a delete-order rollback) → stock (single atomic service, conditional decrement, transactional multi-line claim) → durable email queue → admin fulfilment (server-first tabs, optimistic rollbacks) → cancel/refund (atomic transition, stock+refund compensation) → eBay mirror (event-driven push + sweep + drift reconcile, central-authoritative).

Every subsystem scorecard:

| Subsystem | Verdict | Best evidence |
|---|---|---|
| Database | ✅ excellent | 22 migrations aligned; Decimal money; tokenVersion; P1-10 |
| Checkout / PayPal / stock | ✅ excellent, 1 red | idempotency + capture-amount verify + auto-refund (P2-6); the 🔴 is the lying cancel email (P2-1) |
| Accounts & sessions | ✅ solid | CSRF fail-closed, tokenVersion revocation, enumeration-safe register (P3-1) |
| Catalog & search | 🟡 works today, degrades | URL-facet listing + date-aware pricing (P4-11); search index never wired (P4-1) |
| RFQ / emergency / contact | 🟡 works, promises unverifiable | funnels wired + honest errors (P4-11) but SLA never stamped (P1-2, P4-3), abuse budgets weaker than offers (P4-5) |
| Admin console | ✅ strongest subsystem | all 17 pages real; publish verification triple-checks (P5-12) — minus the darker spots P5-1/P5-4/P5-5 |
| Emails | 🟠 correct infra, lying words | durable queue; wording leaks (P2-1/P6-2), escape gaps (P6-1), currency hard-code (P6-3) |
| i18n / SEO / PWA | ✅ excellent | 684/684/684 keys, URL-locale boot, hreflang fixed, stale-shell SW fixed (P6-9) |

### Launch gate — refuse to ship with these unfixed (all small)

1. **P2-1 + P6-2** 🔴 — customer cancel-request email says "has been cancelled". Support-desk poison, ticket-guaranteed.
2. **P5-1** 🟠 — `cancelRequested` invisible to any admin surface; combined with (1) the store can double-ship after an unpaid request.
3. **P5-4** 🟠 — "Send Invite" sends nothing and the shown-once `Math.random()` password has no recovery path in the UI.
4. **P2-2** 🐛 — invoice SKU column always empty on the money document a bookkeeper needs.
5. **P6-1** 🟠 — user-controlled text lands unescaped in customer emails (spoofing surface).
6. **P1-8** 🟡 — `site.currency` offers INR/JPY that PayPal cannot charge: silent checkout death by config.
7. Plus the one true shame-of-the-week: **P5-5** — PayPal config UI that changes nothing (either wire it or relabel it).

### Prioritized fix backlog

**Tier A — pre-launch (small, high leverage)**
| ID | Fix | Effort |
|---|---|---|
| P2-1, P6-2 | New `cancellationRequested` template; refund status in decided-cancel mail | S |
| P5-1 | `cancelRequested` badge + filter tab + server `statusCounts` count | S |
| P5-4 | Crypto-random password, deliver by email queue, add per-row password reset wired to existing PUT | M |
| P2-2 | `item.productSku?.trim()` | XS |
| P6-1 | `escapeHtml` pass over 5 email templates | S |
| P1-8 | Restrict settlement list to PayPal-chargeable currencies (or warn per-currency in the settings UI) | XS |
| P6-4 | `queryClient.clear()` in `adminLogout` | XS |
| P2-3 | Ship email only on first tracking + move status to shipped | S |
| P6-3 | `formatMoney(revenue, siteCurrency)` in adminReport | XS |
| P4-2 | `getEffectivePrice` in search price field | XS |

**Tier B — next sprint**
| ID | Fix | Effort |
|---|---|---|
| P1-3 + P5-3 | Urgency priority order + server `urgencyCounts` badges | S |
| P1-2 + P4-3 | Stamp `firstResponseAt`; give standard RFQs the 4h deadline the UI promises; feed dashboard overdue logic | M |
| P4-1 | Wire the dead tsvector index (`websearch_to_tsquery`) or add trgm columns for description/identifiers | M |
| P1-7 | Order CSV rework (customer email, SKUs, country) with formula-injection guard | S |
| P2-4 | Allow downward status moves with audit note | S |
| P4-5 | Offer-style budgets for RFQ/contact/emergency submissions | S |
| P5-2 | Admin console currency formatting from `useStoreSettings` (one helper, ~10 surfaces) | M |
| P5-5 | Relabel or wire PayPal config block | S |
| P3-2 | "Sign out of all devices" button + endpoint | S |
| P3-4 | Dedicated refresh-endpoint limiter | XS |
| P4-4 | Server-stamp `consentAt` on consented RFQs; emergency consent semantics | XS |
| P1-4 | Emergency flow: no fake customer email (schema nudge or drop the synthetic RFQ) | S |
| P4-8/P4-9 | Filter chips completeness; offer-checkout ×qty rows | XS |
| P5-7 | Insights: move aggregates server-side or annotate "sampled"; drop dead offers fetch | S |

**Tier C — hygiene / observability (queue when convenient)**
- Dead code removal batch: `middleware/auth.ts:258-268` (P3-3), `generateOrderId`/`generateRfqId` fallback + `offerJustSubmitted` (P4-6/P4-7), `src/hooks/useProducts.ts` (P6-8), checkout price fields (P2F-1), `store.notifications.lowStockThreshold` (P5-8), Messages paperclip UI (P5-10), `site.phoneNumber` key (P1-9/P5-11).
- Drop the `RfqItem` table or wire multi-item RFQs (P1-1) — product decision required (customers likely expect multi-item RFQs).
- `@@index([shippingEmail])` migration (P1-5); nightly retention for email_queue/webhook_logs/ebay_event_log (P1-6); audit-log entries for eBay autosync stock/price writes or a `stock_events` ledger (P6-6).
- Pin `dir/lang` in AdminLayout (P6-5); cart `refreshCartPrices` on visibility regain (P6-7); shipping-zone rate-type control or removal (P5-6); client-side `RequireRole` plates (P5-9); Insights sampling wording (P5-7); brand-slug SEO label + Home tile slug coupling (P4-8); manifest 192/512/maskable icons.

### What this audit deliberately did NOT change

No source file was modified — every finding is read-only evidence with file/line anchors, so the owner (or agent) can fix each item against its taped-out fix. The two docs (`findings.md`, `PRODUCTION_AUDIT.md`) together answer: **the code is ship-worthy after the Tier-A list lands; the deployment side still has its own gate in `PRODUCTION_AUDIT.md` ("NOT READY") — clear both gates in that order.**


