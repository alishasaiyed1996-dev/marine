# Manual Tasks — Alka Traders

Everything here **cannot be done from code** — it needs a human with account access.
Each task lists exact steps and how to verify it worked. Code-side work is tracked
separately in the agent todo list; this file only holds manual actions.

> Convention: whenever a task comes up that requires manual action (external
> dashboards, credentials, physical testing), add it to this file.

---

## 🔴 Pending now

### MT-20 · ✅ DONE — SSR rate-limit exemption + brand discovery (2026-10-27)

Completed from the workstation with Railway CLI access; recorded here because parts of it
(verification cadence) recur after every deploy.

**Automated/done:**
- `SSR_API_TOKEN` is set (same value) on both Railway `api` and `marine`, and `preserve()`d
  in `.railway/railway.ts` so config applies keep it. Rotation = new `openssl rand -hex 32`
  value set on BOTH services (brief 503 burst on hubs until both land — deploy them together).
- `npm run index:audit` after any frontend deploy: must stay `0 errors` across all sitemap
  URLs. A reappearing 503 rate means the token drifted between the services.
- Brand backfill ran on production via `railway ssh --service api`:
  `tsx scripts/backfill-product-brands.ts --apply` — created 64 inventory brands
  (PROTO 124 products, RIDGID…), linked 564/1,074 published products (52.5%), filled hub
  reference copy. Brand hubs entered `/sitemap.xml` live. Brands left unlinked on purpose:
  the ~40 below the 3-product gate (Makita, Milwaukee, Kawasaki, Daewoo, Motorola, …) —
  widen with `--min-products=2` only when someone decides those hubs are worth pages.

**Still manual:**
1. Search Console → re-submit `/sitemap.xml` (the wizardery MT-5 gate) and re-validate the
   867 URLs listed in SEO_URL_LIST.md; they now serve 200 (was 503 + noindex).
2. MT-8 service-account setup to run `gsc:audit` for real index verdicts per URL.

### MT-19 · 🔴 URGENT — email delivery on Railway (SMTP ports are blocked)

**Diagnosed 2026-10-23.** Railway blocks outbound SMTP ports 25/465/587/2525.
The live `email_queue` shows four admin emails failed with `Connection timeout`
and `ENETUNREACH ...:465`; the SMTP credentials are set but cannot be reached
from Railway. The backend now supports Resend over HTTPS 443 when
`RESEND_API_KEY` is set, and keeps SMTP as a fallback for hosts that allow it.

1. Create a Resend account and verify `alkatraders.co` (add the DNS records it
   gives you).
2. Create an API key (`re_...`).
3. Add `RESEND_API_KEY` to the Railway `api` service variables. Keep
   `EMAIL_FROM=sales@alkatraders.co`; it must be on the verified domain.
4. Redeploy. The startup log should say `transport: resend`.
5. Submit a test RFQ. `email_queue.status` must be `sent`, and both
   `sales@alkatraders.co` and `rfq@alkatraders.com` should receive it.
6. Old `failed` rows do not auto-retry; replay them only if the old reports
   are still useful.

### MT-18 · 🔴 URGENT — rotate leaked JWT/CSRF secrets and the admin password

**Found 2026-10-23.** The old backend JWT fallback was committed to git
history and is byte-for-byte the `JWT_SECRET` in root `.env.production` and
`backend/.env.hostinger`; `CSRF_SECRET` in those files is the same value. The
removed e2e fallback also matched `ADMIN_PASSWORD` in root `.env.production`.
Treat all three as compromised.

1. Generate new random values for `JWT_SECRET` and `CSRF_SECRET` in every
   deployed environment (Railway `api`, Hostinger backend, and any other).
2. Change the live admin password in the database/admin UI. Changing
   `ADMIN_PASSWORD` in an env file does **not** update the existing password
   hash.
3. Update the ignored local env files; never commit them.
4. Redeploy. Production now refuses to boot when `JWT_SECRET` or `CSRF_SECRET`
   still matches the known leaked value (hash denylist in
   `backend/src/utils/env.ts`).
5. Verify: old sessions are invalidated, admin login works with the new
   password, and the frontend build contains no server secret values.

### MT-13 · 🔴 URGENT — live storefront has no products (catalog data is gone)

**Diagnosed 2026-10-19.** The live Railway API/database contains **no products
in any status** (published, draft, archived = 0) — also no orders, customers,
media, or eBay listing mappings. Only 22 brands + 19 categories exist (all
created 2026-10-15).

**Follow-up 2026-10-19 — the Neon database was checked too.** It is still
reachable from `backend/.env` (note: Node on this Windows machine needs
`NODE_OPTIONS=--dns-result-order=ipv4first`, otherwise it resolves only AAAA
and times out), but the real catalog is **not there either**:

| Table | Neon rows |
|---|---|
| `products` | 4 — all test/duplicate leftovers (`kjnjkhkjjkhjk`, `LIVE-TEST-PRODUCT`, `DUP-SOURCE`, `DUP-SOURCE (Copy)`) |
| `customers` | 6 (stale; 0 orders) |
| `categories` / `brands` | 19 / 23 |
| `orders`, `ebay_listings`, `ebay_orders` | 0 |
| `email_queue` | 16 (historic rows) |

There are no backups/dumps in the repo and the Wayback Machine has **zero**
snapshots of `alkatraders.co` (CDX query returns `[]` for the site and for
`/product/*`). So the earlier 8-item catalog is not recoverable from Neon, the
Railway copy, local files, or the web archive — it was deleted before/at the
Railway migration.

**Action (project owner):**
1. Decide the catalog source: rebuild manually from supplier documents, or
   authorise a one-off import of the current **eBay store's live listings**
   into the website catalog (the seller token can read them; the old import
   tooling was removed, so this would be new scripted work).
2. Once products exist, MT-4 (identity fields) and the eBay stock sync become
   exercisable again.

**Implemented 2026-10-21 — eBay → catalog importer.** The old read-only
listing view now has an **Import active EBAY_US** action
(`Admin → eBay Inventory`). It discovers active listings with
`GetMyeBaySelling`, pulls full details with `GetItem` (description, all
pictures, item specifics), mirrors images to Cloudinary, and creates **draft**
products with the eBay price/quantity/condition/identity fields. It is
idempotent (skips already-mapped item IDs, links existing SKUs instead of
duplicating) and resumable (`ebay_import_jobs.cursor` survives restarts).
Imported listings without an Inventory API offer id now sync stock through the
Trading API `ReviseInventoryStatus`, so website sales still decrement eBay.

**Remaining manual steps:**
1. Deploy the additive migration `20261021000001_ebay_catalog_import`
   (Railway preDeploy runs `prisma migrate deploy`; confirm it applied in the
   API service logs). Do not run `migrate dev`.
2. Confirm the API service still has `EBAY_CLIENT_ID`,
   `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `EBAY_ENV=production`, and
   `EBAY_SITE_ID=0` (EBAY_US).
3. Open **Admin → eBay Inventory → Import active EBAY_US** and let the job
   finish. Tune `EBAY_IMPORT_BATCH_SIZE` / `EBAY_IMPORT_MAX_IMAGES` only if
   Cloudinary or eBay rate limits require it.
4. Review the drafts in **Admin → Products**, assign categories/identity
   fields, then publish. Drafts intentionally do not bypass the publish gate.

Group C (eBay stock sync) lights up the moment products with matching SKUs
(e.g. `Z 35`, `C 126`, `E 206`) exist in the catalog.

---

### MT-16 · Replace the eBay tool testimonials with marine references

**Why (U-14/C-5):** the six reviews in `src/data/testimonials.ts` are genuine
verified eBay purchases, but they are pipe vises, threaders, tubing benders and
chain tongs — not marine spares. The section is now honestly labelled
"Marketplace Feedback" / "Verified feedback from our eBay buyers" and says the
reviews cover the industrial tooling and surplus equipment sold on eBay. The FAQ
also claims only what the terms support (condition grades, no automatic
certificates). Only real marine buyers can supply the marine proof.

**Action:** collect 3–6 references with permission: company, role, vessel or
plant type, part family purchased, destination, and a 1–3 sentence quote. Add
them as a marine references block; keep the eBay entries on the marketplace
feedback block, because they are real feedback.

---

### MT-17 · Real company + bank details in store settings

**Why (C-5, U-2):** the admin defaults are now honest placeholders
(`+91 87990 95041`, `Asia/Kolkata`, empty bank fields) instead of a UAE phone
number and an Emirates NBD IBAN for the Indian entity. Bank transfer stays
**unavailable at checkout** until real details are entered.

**Action in Admin → Settings → Payments:**
1. Bank Transfer → fill bank name, account name, account number, IBAN/SWIFT
   (or IFSC) for the account that should receive customer wires.
2. Letter of Credit → fill the accepting-bank list if L/C terms are offered.
3. Settings → General: confirm company name, phone, address, timezone and
   currency match the legal entity (GSTIN/VAT belongs on invoices, not in these
   fields).

**Verify:** checkout shows bank instructions and the review step accepts a
bank-transfer order; before that it offers only the methods that work.

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

### MT-14 · eBay: subscribe to order notifications (portal only — API refused)

**Re-diagnosed 2026-10-19.** The notification destination is already
`ENABLED` (`https://api.alkatraders.co/api/webhooks/ebay`), but the only
subscription on the app is the mandatory `MARKETPLACE_ACCOUNT_DELETION`. The
topic that carries new orders is `ORDER_CONFIRMATION` ("buyer completes
checkout"; scope USER; listed `authorizationScopes`: `sell.fulfillment` /
`sell.fulfillment.readonly`). Creating the subscription via the API failed for
every variant attempted:

- application token → `403 / 195011 "Not authorized for this topic"`
- seller token with `sell.fulfillment` (granted; `readonly` is not granted) →
  `403 / 1100 "Access denied … Insufficient permissions"`
- same with `X-EBAY-C-MARKETPLACE-ID: EBAY_US`, `schemaVersion 1.1`,
  `status: DISABLED`, and an omitted payload → identical 403

So for this app eBay only exposes the subscription through the
**developer-portal Notification UI**. **Action:** portal → your app →
Notification subscriptions → enable the order-confirmation/order-created
topic(s). The backend verifies the endpoint and accepts any topic that carries
an order id; deliveries are logged in `ebay_event_log`.

The **polling safety net** remains live regardless: the scheduler pulls recent
Fulfillment orders every 10 minutes, so a missed webhook still imports the
order (order-level dedupe prevents double stock claims).

### MT-15 · eBay: warehouse address for the merchant location

Creating **new listings through the app** (Inventory API) needs a
`merchantLocationKey`. The account currently has **no** inventory locations
(verified 2026-10-19) and the location must carry the real ship-from address.

**Action:** send the dispatch address (warehouse name, street, city, state,
postal code, country, phone). It gets created once via the Inventory API, then
`EBAY_MERCHANT_LOCATION_KEY` is set on Railway. Quantity sync for
already-listed products does **not** need this.

**Candidate found in code (needs owner confirmation):** the storefront's
Organization JSON-LD already publishes the business address
`PLOT - 7 ALANG HOUSE, MOTITALAV ROAD, KHUMBHARWADA`, Bhavnagar, Gujarat.
If that is also the correct ship-from address, reply with the postal code,
phone number, and preferred location key (suggested: `alka-bhavnagar`) — the
location can then be created via the Inventory API and the Railway variable
set without further code changes.

**Observed 2026-10-19 (portal follow-up):** the endpoint is receiving real
eBay deliveries (`MARKETPLACE_ACCOUNT_DELETION`, several per minute — eBay
fans these out to every registered app; the deploy that shipped real-envelope
parsing labelled them correctly for the first time). They are logged and
ignored. If the app should actively purge a deleted buyer's order data on
receipt (eBay compliance), that is a small follow-up code task.

### MT-6 · Sentry (or similar) account + DSN (E41)

Create the project(s), put the DSNs in Railway env vars (`SENTRY_DSN_FRONTEND`,
`SENTRY_DSN_BACKEND`), then wire the SDKs (code task E41).

### MT-7 · Neon backup verification (E43)

Neon dashboard → project → **Backups / PITR**: confirm point-in-time restore is
available on the current plan and do one test restore into a throwaway branch.
The full procedure is in `docs/backup-restore.md`; record the date, retention
window, and operator in the operations log after the test.

### MT-8 · Search Console API access (unlocks B10 automation)

The sitemap is already auto-generated and MT-2 covers one-time submission.
Automating Search Console (index-coverage monitoring, impressions/clicks pull)
needs Google API credentials. **The client is already written** —
`npm run gsc:audit` (`scripts/gsc-index-audit.mjs`) drives the URL Inspection
API over every sitemap URL and reports, per URL, the index verdict, coverage
state, last crawl time and whether Google picked a different canonical. It is
dependency-free (JWT signed with node:crypto) and needs no Railway deploy —
it runs from this workstation against the public API.

Setup (scratch start — the domain property is already verified):

1. Google Cloud Console → create a project → enable the **Search Console API**.
2. Create a **service account**, then create a **JSON key** for it.
3. In Search Console → Settings → Users and permissions, add the service
   account's `...@....iam.gserviceaccount.com` email as a user (Full or
   Restricted is enough for inspection).
4. Put the JSON key where the script can read it:
   - local: set `GSC_SERVICE_ACCOUNT_FILE=D:/path/to/key.json` in `.env`
     (ignored) or export it in the shell;
   - the script also accepts the raw JSON in `GSC_SERVICE_ACCOUNT_JSON`.
5. Override the property if it is not a Domain property:
   `--site https://alkatraders.co/` (default is `sc-domain:alkatraders.co`).

No credentials yet? `npm run gsc:audit -- --dry-run` still enumerates and
classifies every sitemap URL, so the tool is usable before setup.

Quota: the URL Inspection API allows ~2,000 inspections per property per day
and ~600 per minute. Use `--limit` and `--resume` for a full 1,125-URL pass.

Until this is wired, review performance manually at
search.google.com/search-console.

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

### MT-12 · Automated email delivery — SMTP configured on Railway (verify)

**Update 2026-10-23:** SMTP credentials are set, but Railway blocks outbound
SMTP ports, so delivery fails with connection timeouts. Use the Resend HTTPS
transport in **MT-19** instead.

**Status 2026-10-19:** SMTP is the email transport (send; the mailbox also
receives replies). `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`,
`SMTP_SECURE`, `EMAIL_FROM`, and `SALES_EMAIL` are set on the Railway `api`
service by the owner. The service sends through nodemailer and records honest
queue states (`sent` / `retrying` / `failed` / `skipped`) — it never marks
undelivered mail as sent.

**Verify after the next deploy/restart:**
1. Submit a test RFQ / contact message on the live site.
2. `Railway → api → Logs` should show no email delivery errors.
3. The new `email_queue` row must be `sent` with `attempts ≥ 1`, and sales@
   must receive the message (check spam once; mark not-spam if needed).

### MT-11 · Write real category & buying-guide content (B13/B14)

Framework is live (category description renders on the Products page; product
pages render structured identity). What's missing is **human-approved copy** —
not AI filler. For each real category (and the top ~5 IMPA/industry queries
Alka actually wins on), write 2–4 factual paragraphs: what it is, materials,
supplier standards, and how to request a quote. Paste into the category
`description` field (admin) — the page renders it automatically.

### MT-21 · Review the catalogue name/slug normalization plan, then approve --apply

**Code delivered:** `backend/scripts/normalize-product-names.ts` (dry-run by
default; writes only with `--apply`). It cleans stored product names of
marketplace noise ("fast ship", "free shipping", …), regenerates slugs from
the clean names, records every old slug in `product_slug_history` (permanent
301s), and bumps `content_updated_at`.

**Steps:**
1. Dry-run in production and read the plan end to end:
   `railway ssh --service api -- /app/node_modules/.bin/tsx scripts/normalize-product-names.ts`
2. Check the "skipped, needs review" list — those titles are pure noise and
   need a human-written name in admin.
3. If the plan is acceptable either run it staged
   (`--limit=200`) or full (`--apply`).
4. After apply: `npm run index:audit` locally (old URLs must answer 301, new
   ones 200), then resubmit `/sitemap.xml` in Search Console.

**Gate:** do NOT run `--apply` without reading the plan — it rewrites up to
~1,000 product URLs in one pass. Deliberate decision record B9.

### MT-22 · Trust-layer facts only the owner can provide (SEO §10)

Rank-worthy competitors state verifiable process facts; we cannot invent
ours. Owner inputs, then paste into site copy (About, RFQ, product pages):
1. Exact company registration (GSTIN / CIN) + registered address to publish.
2. Our real inspection/QC steps before dispatch (what we check, tools, docs
   we can supply: test/QC report, packing list, commercial invoice).
3. The response-time SLA we can honestly keep on RFQs (hours).
4. Which ports we actually ship to / agents we use — port pages only when
   real (reduces the thin-content risk in SEO §12.4).
5. Alang/ship-recycling stock origin: confirm what we can truthfully claim
   about where parts come from before writing that positioning copy.

### MT-23 · Search Console re-setup from scratch (owner deleted the old property — 2026-10-27)

**What actually happened to Google's index:** deleting a Search Console property does NOT reset or
de-index the site — Google's index and all current rankings stay exactly as they are. What is
lost is the historical Performance data of the deleted property (queries/pages/countries before
today). Going forward everything accrues fresh in the new property; no ranking benefit, no
ranking penalty.

Steps (owner, ~45 min):
1. search.google.com/search-console → Add property → **Domain** → `alkatraders.co` (covers
   `alkatraders.co`, `www`, and `api.` in one property).
2. Verification: DNS TXT record — copy the string GSC gives, add it in the domain's DNS panel
   (registrar/Cloudflare/wherever the alkatraders.co DNS is managed), press Verify. DNS can take
   minutes to a few hours.
3. Sitemaps → add `https://alkatraders.co/sitemap.xml`. The sitemap is served live from the API
   (verified 200) and robots.txt already links to it; GSC's Settings → robots.txt report must
   show the live file without errors.
4. URL Inspection → Request indexing for: homepage, `/en/brands/`, 10 top brand hubs, 10 top
   product pages (bounded — do not blast hundreds).
5. When MT-8 (service account) is done, `gsc:audit` resumes — but the service account must be
   granted on the NEW property (re-run the B10 grant if it was tied to the deleted one).

### MT-24 · eBay: report buyer countries from Seller Hub (feeds the geo emphasis of hub pages)

Two places, both free; keep the two signals separate in the report:
1. **Who actually bought:** Seller Hub → Orders → date range **Last 2 years** → "Download"
   (CSV) → Excel → the **Sold To / Ship-to country** column → PivotTable of country → order
   count. Report the top 10 with counts.
2. **Who visits:** Seller Hub → Marketing → Listing analytics → Traffic → **Geography**
   (visitors by country) — demand signal, not sales.
3. Paste the top-10 list to the agent → hub pages emphasise the real destinations
   (SEO_RANKING_RESEARCH.md §13 provisional base).

### MT-25 · GA4: register the new `rfq_submit` event as a key event

The storefront now sends `rfq_submit` on every RFQ (both forms — /rfq page and the home
section). The DB `Rfq.source` column records the channel even without analytics consent;
GA4 sees the event only with consent. One-time owner steps (~30 min):
1. analytics.google.com → Admin (property G-2556Z1FEES) → Events → after the first RFQ
   submission `rfq_submit` appears in the events list → toggle **Mark as key event** (or create
   the key-event rule manually before any submit arrives).
2. Admin → Custom definitions → Create custom dimension (scope: **Event**) for:
   `rfq_origin`, `rfq_page`, `rfq_urgency`, `rfq_has_part_number`, `rfq_country`,
   `attribution_source`, `attribution_medium`, `attribution_campaign`, `attribution_referrer`.
3. Admin → Data settings → Data retention → Events: **14 months** (free-tier maximum).
4. Reports → Engagement → Events → `rfq_submit` row → counts must match the admin RFQ list.

---

## Decision records — group B (SEO architecture)

- **B9 · Product name/slug migration — decision revisited 2026-10-27.**
  Originally deferred when the catalog was 8 items (re-index cost > gain).
  The catalog is now 1,074 imported products, some with marketplace-junk
  names/slugs (`-new-fast-ship-ffedex` tokens), and identity URLs are the core
  ranking asset. `backend/scripts/normalize-product-names.ts` delivers the
  migration with permanent 301s via `product_slug_history`; apply gate is
  MT-21. See SEO_RANKING_RESEARCH.md §11/§12.
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
