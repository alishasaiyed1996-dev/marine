# Manual Tasks — Alka Traders

Everything here **cannot be done from code** — it needs a human with account access.
Each task lists exact steps and how to verify it worked. Code-side work is tracked
separately in the agent todo list; this file only holds manual actions.

> Convention: whenever a task comes up that requires manual action (external
> dashboards, credentials, physical testing), add it to this file.

---

## 🔴 Pending now

### MT-13 · 🔴 URGENT — live storefront has no products (database question)

**Diagnosed 2026-10-19.** The live API/database contains **no products**
(published, draft **and** archived are all zero) — also no orders, customers,
or media. Only brands + categories exist, all created **2026-10-15**, and the
audit log's first entries are from that date. The live site confirms it:
sitemap has no `/product/` URLs and the homepage renders no products. So this
is a **fresh, mostly-empty database** — not a catalog deleted from it.

Two possibilities:
1. The real catalog lives in the **previous database (Neon)** and was never
   (fully) migrated to Railway Postgres, or
2. the catalog was intentionally wiped and needs rebuilding.

**Action (project owner):**
1. Open the Neon dashboard (see MT-7) → SQL editor → check
   `select count(*) from products;` (and orders).
2. If data exists there: export/restore it (point-in-time branch, or CSV
   export), and we re-import through the admin importer or a script.
3. If not: rebuild the catalog (the eBay store is not imported — old listings
   are intentionally unmanaged; see MT-5).

Group C (eBay stock sync) lights up the moment products with matching SKUs
(e.g. `Z 35`, `C 126`, `E 206`) exist in the catalog.

---

### MT-1 · Submit Merchant Center feed (A3)

**Where:** [Google Merchant Center](https://merchants.google.com/) (needs a Google account with an MC account created for alkatraders.co)

1. Merchant Center → **Products → Feeds → Add feed** (or "+ Create feed").
2. Choose **Scheduled fetch**.
3. Fill in:
   - **Name:** `Alka Traders primary feed`
   - **Country of sale:** `United States` (add more countries later as needed)
   - **Currency:** `USD`
   - **File URL:**
     ```
     https://api.alkatraders.co/api/v1/storefront/merchant-feed.xml
     ```
   - **Frequency:** Daily (feed is cached 1h server-side, safe to fetch often)
4. Save, then click **Fetch now** to force the first fetch.

**Verify:**
- After fetch opens, check **Products → Needs attention**.
- Expect a few warnings on first pass (e.g. missing `shipping`/`tax` if the
  account requires them — set those in **Settings → Shipping** first if so).
- The feed currently ships 1+ products with real `brand`, `mpn`, `condition`,
  `price`, `availability`. IMPA codes ride in `custom_label_0`.
- **Never** expect `gtin` unless a product has a verified GS1 GTIN in the admin
  identity fields — absence of GTIN shows a "limited performance" warning, not an error.

---

### MT-2 · Submit sitemap to Search Console (A4)

**Where:** [Google Search Console](https://search.google.com/search-console) (property for `alkatraders.co` must exist — use the Domain property if DNS access is available)

1. Search Console → **Sitemaps** (under Indexing).
2. Enter: `sitemap.xml` → Submit.
   - Full URL: `https://alkatraders.co/sitemap.xml`
3. Also check **Settings → Crawl stats** later to confirm Googlebot activity.

**Verify:**
- Sitemap row shows **Success** with discovered URL count (should equal static
  routes × 3 locales + products × 3 locales — currently ~54).
- After 3–7 days: **Indexing → Pages** should start showing product URLs as
  "Indexed". Run `npm run seo:audit` locally any time to self-check health first.

---

### MT-3 · Test the accepted-offer PayPal checkout end-to-end (A5)

**Why:** API layer is verified healthy in production (validation 400s, auth 401s,
DB reachable, scheduler running), but a real payment has not been made since the
offer-payment migrations ran.

**Steps:**
1. On the live site (customer account, **not** the admin account): find or create
   a product, submit an offer via **Make Offer**.
2. In the admin panel: accept the offer (sets the accepted price + payment window).
3. Back on the storefront: **My Offers** → open the accepted offer → pay via the
   PayPal button (use a real sandbox→live PayPal account per environment).
4. Confirm:
   - Order appears in **Admin → Orders** with the negotiated price snapshot.
   - Offer status transitions: `accepted → paid`.
   - Customer sees the order in their account.
   - Stock behaviour is correct on the purchased product.
5. Also verify the **expiry sweep**: accept an offer and let the payment window
   lapse (or temporarily shorten the window in a staging DB) — offer should flip
   to expired and the product should return to available.

**Verify:** no errors in Railway `api` logs during the whole flow
(Railway dashboard → api service → Deployments → Logs).

---

## 🟡 Pending later (tie to roadmap groups)

### MT-4 · Enter product identity fields in admin (form ready: Admin → Products → edit → SEO tab → "Product Identity")

For every product where documentation is at hand, fill in:
`manufacturer`, `model number`, `MPN`, `GTIN` (only if a **verified GS1 GTIN**
exists), `IMPA code`, `source URL`, and set `last verified at`.
Products with identity filled feed better titles, richer JSON-LD, and a stronger
Merchant feed. Until then the feed falls back to description parsing — correct
but less complete.

### MT-5 · eBay integration — CONNECTED 2026-10-19 (two small steps remain)

The integration is live on production. What was done:

1. eBay app created; `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` set on Railway `api`.
2. Seller user-token (refresh grant) obtained and stored as
   `EBAY_REFRESH_TOKEN` — valid until **~April 2028**; Sell APIs verified live
   (orders, inventory, business policies, locations).
3. Business policy IDs collected for **EBAY_US** (the marketplace the shop
   actually sells on) and set on Railway:

   | Variable | Value |
   |---|---|
   | `EBAY_FULFILLMENT_POLICY_ID` | `266639603012` (FREE SHIPPING, 3-day handling) |
   | `EBAY_PAYMENT_POLICY_ID` | `255031886012` (eBay managed payments) |
   | `EBAY_RETURN_POLICY_ID` | `255031915012` (RETURN 30 DAYS ALL PRODUCTS) |

4. Notification endpoint registered + challenge verified:
   `https://api.alkatraders.co/api/webhooks/ebay`.
5. Stock sync model (owner-confirmed 2026-10-19): the **product SKU is the
   link** between the two channels. An eBay sale claims the website product's
   central stock (the site flips to out-of-stock at 0); a website sale pushes
   the new quantity to the matching eBay listing(s) within 10 minutes. The
   legacy-listing import tooling was removed the same day at the owner's
   request — old Seller-Hub listings are **not** managed by the app.

   **Live-proven 2026-10-19:** a real eBay order for SKU `Z 40` claimed a
   website product's central stock 1 → 0 through the webhook pipeline and the
   product flipped to out-of-stock (no mirror listing row involved). The probe
   product and all probe rows were deleted afterwards; the catalog is back to
   its prior (empty) state.

Still to do:
- **MT-14** — subscribe to the order notification topic(s) in the portal.
- **MT-15** — warehouse address → merchant location key (needed to list
  products to eBay from the app).

When the catalog is back, list products to eBay from the admin panel
(**eBay Inventory**) — that creates the mapping the sync runs on.

### MT-14 · eBay: subscribe to order notifications (portal)

In the eBay developer portal → your app → **Notification subscriptions**,
enable the **order-related topic(s)** (order created / order paid — pick the
ones the portal lists). The backend verifies the endpoint and accepts any
topic that carries an order id; deliveries are logged in `ebay_event_log`.

A **polling safety net** is live regardless: the scheduler pulls recent
Fulfillment orders every 10 minutes, so a missed webhook still imports the
order (order-level dedupe prevents double stock claims).

**Observed 2026-10-19:** the endpoint is already receiving real eBay
deliveries (`MARKETPLACE_ACCOUNT_DELETION`, several per minute — eBay fans
these out to every registered app; the deploy that shipped real-envelope
parsing labelled them correctly for the first time). They are logged and
ignored. If the app should actively purge a deleted buyer's order data on
receipt (eBay compliance), that is a small follow-up code task.

### MT-15 · eBay: warehouse address for the merchant location

Creating **new listings through the app** (Inventory API) needs a
`merchantLocationKey`. The account currently has **no** inventory locations
(verified 2026-10-19) and the location must carry the real ship-from address.

**Action:** send the dispatch address (warehouse name, street, city, state,
postal code, country, phone). It gets created once via the Inventory API, then
`EBAY_MERCHANT_LOCATION_KEY` is set on Railway. Quantity sync for
already-listed products does **not** need this.

### MT-6 · Sentry (or similar) account + DSN (E41)

Create the project(s), put the DSNs in Railway env vars (`SENTRY_DSN_FRONTEND`,
`SENTRY_DSN_BACKEND`), then wire the SDKs (code task E41).

### MT-7 · Neon backup verification (E43)

Neon dashboard → project → **Backups / PITR**: confirm point-in-time restore is
available on the current plan and do one test restore into a throwaway branch.

### MT-8 · Search Console API access (unlocks B10 automation)

The sitemap is already auto-generated and MT-2 covers one-time submission.
Automating Search Console (impressions/clicks pull, index-coverage monitoring)
needs Google API credentials:

1. Google Cloud Console → create a project → enable the **Search Console API**.
2. Create a **service account** (or OAuth client) and add its email as a
   **property owner/delegated user** in Search Console.
3. Put the JSON key in Railway (`GSC_SERVICE_ACCOUNT_JSON`, api service).

Until then, review performance manually at search.google.com/search-console.

### MT-9 · Merchant Center Content API (unlocks automated feed push, B11)

The merchant feed route is live (`/api/feeds/merchant-center.xml`) and MT-1
covers manual submission. To have Google pull/refresh automatically or to push
via API later:

1. In Merchant Center link a Google Cloud OAuth client / service account.
2. Enable the **Content API v2** and grant it to the MC account.
3. Store credentials in Railway (`GMC_*` vars).

Cheapest path first: in MT-1, schedule the feed as a **scheduled fetch** in
Merchant Center (`https://api.alkatraders.co/api/feeds/merchant-center.xml`) —
no credentials needed.

### MT-10 · ~~Remove leftover test products from prod DB~~ — DONE 2026-10-01

Resolved by `backend/scripts/remove-test-products.ts` (dry-run + `--apply`).
Deleted 4 rows: `TEST-PRODUCT-HTTP-MODE` ×3 (drafts) + `TXTEST3` (archived),
plus their images/specs. Zero offers/orders/eBay listings affected.
`detect-duplicate-products` now reports a clean catalog.

### MT-12 · Configure SMTP credentials so automated emails actually send (URGENT — sales@ receives nothing)

**Diagnosed 2026-10-01** (`backend/scripts/diag-email-queue.ts`, read-only):
emails were **never delivered** —

1. **Jul 31 – Aug 11:** SMTP was configured but credentials were wrong —
   every send failed with `API key is invalid` (all rows `status=failed`,
   attempts=3).
2. **After that:** `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` went missing from
   the environment — the email service silently switched to **dry-run**,
   marking messages `sent` in the DB without transmitting anything. RFQ,
   offer, contact, emergency, and registration notifications all vanished.
   (Code fix shipped: dry-run now records an honest `skipped` state instead.)

**Fix — set these in Railway (api service → Variables), then redeploy:**

| Variable | Value |
|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | a real mailbox you created in Hostinger → Emails, e.g. `noreply@alkatraders.co` |
| `SMTP_PASS` | that mailbox's password |
| `EMAIL_FROM` | `sales@alkatraders.co` (or the mailbox above) |

Notes:
- Use a **real mailbox** created in the Hostinger email panel
  (`noreply@alkatraders.co` is ideal) — arbitrary usernames fail auth.
- Hostinger SMTP requires the mailbox to exist; "API key is invalid" errors
  mean the user/pass pair was wrong, not the mailbox missing.
- SPF already covers Hostinger (`v=spf1 include:_spf.mail.hostinger.com ~all`),
  so correctly-authenticated mail will land in inboxes.

**Verify after redeploy:**

1. Submit a test RFQ / contact message on the live site.
2. `Railway → api → Logs` should show no `Email delivery failed` errors.
3. Run `cd backend && npx tsx scripts/diag-email-queue.ts` — new rows must be
   `sent` with `attempts ≥ 1`, and sales@ must show up in your actual inbox
   (check spam once; if it's there, mark it not-spam).

### MT-11 · Write real category & buying-guide content (B13/B14)

Framework is live (category description renders on the Products page; product
pages render structured identity). What's missing is **human-approved copy** —
not AI filler. For each real category (and the top ~5 IMPA/industry queries
Alka actually wins on), write 2–4 factual paragraphs: what it is, materials,
supplier standards, and how to request a quote. Paste into the category
`description` field (admin) — the page renders it automatically.

---

## Decision records — group B (SEO architecture)

- **B9 · Slug/URL migration — deferred.** Current URLs are stable,
  prerendered, and indexed (42 URLs, trailing-slash, sitemap'd). Changing slug
  schemes forces 301 mapping + re-indexing for zero measurable gain on an
  8-item catalog. Revisit only if the real catalog grows and identity-based
  slugs (`/product/impa-232483-scupper-plug/`) become worth the migration.
- **B12 · Per-brand landing pages — deferred.** `Brands.tsx` is an honest
  showcase with live product counts; thin per-brand pages would hurt, not
  help, with 8 products. Revisit at ≥5 real brands.
- **B13/B14 · Category content & buying guides — human copy required.** See
  MT-11; the rendering framework is done and waiting on real text.
- **B15/D37 · Image alt text — done in code.** `buildImageAlt()` builds
  identity-rich alts (brand + model + IMPA) from structured fields, falling
  back to the catalog name; wired into grid, gallery, and related products.
- **B22 · Variant strategy — single pages.** No real size/variant rows exist;
  each item is its own product page (correct for IMPA-part catalogs). If
  genuine variants appear, model them as separate products sharing identity
  (brand/model/IMPA) rather than introducing a variant schema.
- **B10/B11 · Search Console & Merchant Center APIs — credential-gated.**
  See MT-8/MT-9; no code until credentials exist.

---

## ✅ Completed manual items

- **MT-10 (2026-10-01)** — test products removed from prod DB via
  `remove-test-products.ts --apply`; catalog verified clean.
- **MT-5 (2026-10-19)** — eBay connected end-to-end on production: refresh
  token stored (valid to ~April 2028), EBAY_US business policies collected +
  set, webhook endpoint verified and receiving real eBay deliveries; stock
  sync wired with the product SKU as the channel link (legacy-listing import
  removed same day at owner request). Follow-ups: MT-14 / MT-15.

---

## Environment variables reference (Railway)

Set only in Railway dashboard → service → Variables. Never commit real secrets.

| Variable | Service | Purpose | Status |
|---|---|---|---|
| `DATABASE_URL` | api | Postgres connection (MT-13: catalog currently missing) | ✅ set |
| `SEO_API_BASE` | web (build) | Overrides the API the build fetches products from | optional (defaults to prod API) |
| `SENTRY_DSN_*` | both | Error monitoring (MT-6) | ⬜ pending |
| eBay OAuth creds | api | eBay integration (MT-5, group C) | ✅ connected 2026-10-19 |
| `EBAY_MERCHANT_LOCATION_KEY` | api | Inventory-API merchant location (MT-15) | ⬜ pending |
