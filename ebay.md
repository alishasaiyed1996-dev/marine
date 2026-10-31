# EBAY — complete code map and behaviour reference

Source of truth: the code in this repository (no comments, docs or this file's
prose are treated as authority — where behaviour matters the referenced lines
are cited). Last verified against the working tree after the fixes listed in
§15.

Scope: the whole eBay channel — backend services/routes/schedulers, database
models, admin API client and the two admin screens (eBay Hub, eBay Inventory).

---

## 1. File inventory

| File | LOC | Responsibility |
| --- | ---: | --- |
| `backend/src/services/ebayClient.ts` | 253 | OAuth (client-credentials + refresh-token grant), Sell Inventory/Fulfillment REST calls, retry classification |
| `backend/src/services/ebayTradingService.ts` | 492 | Trading XML API: `GetMyeBaySelling`, `GetItem`, `ReviseInventoryStatus`; parsing/aggregation |
| `backend/src/services/ebayCatalogImportService.ts` | 1084 | Discovery walk, resumable import jobs, `importOne`, image mirroring, full content re-sync, auto-publish |
| `backend/src/services/ebayCatalogAutoSync.ts` | 554 | 5-minute reconciliation sweep (new/ended/price/stock/condition/deep mirror) |
| `backend/src/services/ebayMirror.ts` | 167 | Pure mirror-mode decisions: flags, image diff, content diff, photo budget |
| `backend/src/services/ebayCategoryMapping.ts` | 620 | Pure category resolution: pins, aliases, ordered keyword rules, fallback |
| `backend/src/services/ebayCatalogMapping.ts` | 248 | Pure content mapping: HTML→text, condition mapping, identity extraction, SEO builders |
| `backend/src/services/ebayListingService.ts` | 213 | Create/update an Inventory API offer from a website product and publish it |
| `backend/src/services/ebayListingPreviewsPure.ts` | 212 | Pure listing-preview builders/policy (external products, PREFILL/HINT aspect merge) |
| `backend/src/services/ebayListingPreviewsService.ts` | 438 | GraphQL Inventory Mapping orchestration: start task, poll, flatten previews |
| `backend/src/services/ebaySyncScheduler.ts` | 315 | 10-minute quantity/order safety net, event-driven kick, per-row push |
| `backend/src/services/ebayOrderService.ts` | 389 | eBay order → internal order → central stock claim; retries/poll |
| `backend/src/services/ebayOrderEvents.ts` | 98 | Pure payload extractors and `sellableOnEbay` eligibility rule |
| `backend/src/services/ebayImageBackfill.ts` | 239 | One-shot photo-only backfill job (batched, cancellable) |
| `backend/src/services/ebayHubService.ts` | 873 | Admin control-surface queries and audited repair actions |
| `backend/src/services/ebayAdminRuntime.ts` | 181 | DB-backed runtime overrides for mirror/auto-publish/category pins |
| `backend/src/routes/admin/ebay.ts` | 388 | Admin HTTP API (auth + role gates) |
| `backend/src/routes/webhooks/ebay.ts` | 89 | Public endpoint validation + notification intake |
| `backend/src/utils/ebayChallenge.ts` | 30 | SHA-256 endpoint challenge response |
| `backend/src/scripts/recategorizeFromEbay.ts` | 267 | Offline catalog recategorisation (dry-run/report/apply) |
| `src/pages/admin/AdminEbayHub.tsx` | 1504 | Admin hub UI: overview, listings (listing previews card), orders, webhooks, settings |
| `src/pages/admin/AdminEbayInventory.tsx` | 692 | Legacy inventory sync screen (products + live eBay listings) |
| `src/lib/api/admin.ts` (`admin.ebay`) | — | Typed client for every route |
| `src/components/admin/adminNav.ts` | — | Sidebar entries `/admin/ebay`, `/admin/ebay-inventory` |
| `docs/ebay-catalog-sync.md` | — | Operational notes (not authoritative) |
| `docs/ebay-listing-previews.md` | — | GraphQL listing previews flow + auth/scope notes |
| Tests | — | `ebayCatalogMapping.test.ts`, `ebayCategoryMapping.test.ts`, `ebayListingPreviews.test.ts`, `ebayMirror.test.ts`, `ebayOrderService.test.ts`, `ebayChallenge.test.ts` |

Wiring: `backend/src/server.ts` — imports route modules (L112, L138), mounts
webhook at `/api/webhooks/ebay` with a 1 MB JSON body (L237) and admin routes at
`${prefix}/admin/ebay` behind `adminLimiter` + `userAwareAdminLimiter` (L404).
Boot starts sync/import schedulers (L528–529), loads admin runtime overrides
(L533), then starts the catalog sweep (L534). Shutdown stops all three (L455–458).

---

## 2. Database model

`backend/prisma/schema.prisma`

### `EbayListing` (`ebay_listings`, L706–729)
One row per `(sku, marketplace)` — unique `@@unique([sku, marketplace])`, index
on `productId`, cascade delete with product.

| Column | Type | Behaviour |
| --- | --- | --- |
| `productId` | uuid | FK to `products` |
| `sku` | varchar(100) | cross-channel key |
| `ebayOfferId` | varchar(50)? | Inventory API offer |
| `ebayListingId` | varchar(20)? | Trading API item id |
| `marketplace` | varchar(20) | default `EBAY_US` |
| `status` | varchar(30) | `pending`, `published`, `sync-pending`, `synced`, `sync-failed`, `ended` |
| `lastSyncedQty` | int? | last quantity known to match eBay |
| `lastSyncAt` | timestamp? | last successful push/sync marker |
| `lastError` | text? | last push/sync error (shown in Hub) |
| `syncDisabled` | bool | admin pause of website→eBay writes only |

### `EbayOrder` (`ebay_orders`, L732–747)
`ebayOrderId` unique; optional 1:1 `orderId` (unique) to internal `orders`.
`status`: `processing`, `processed`, `failed`, `ignored`; `totalAmount`
decimal(12,2), `currency`, `lastError`, `processedAt`, timestamps.

### `EbayEventLog` (`ebay_event_log`, L750–761)
`eventId` unique (idempotency). `topic`, `payload` JSONB, `status`
(`received`, `processed`, `duplicate`, `failed`), `error`, `processedAt`.
Index `(topic, createdAt)`.

### `EbayImportJob` (`ebay_import_jobs`, L768–788)
`status` (`queued`, `running`, `completed`, `failed`, `cancelled`),
`marketplace`, `itemIds` JSONB work list, `cursor` (next index), counters
`total/processed/created/linked/skipped/failed`, `createdBy` (NULL = system
autosync job), `startedAt/finishedAt`. Index `(status, createdAt)`.

### Supporting columns
- `ProductImage.sourceUrl` (`schema.prisma` L183) — provenance of a mirrored
  photo (raw eBay URL); migration `20261030000000_add_product_image_source_url`.
- `StoreSetting` keys `ebay.fullMirror`, `ebay.autoPublish`,
  `ebay.categoryPins` (see §9).
- `ebay_listings.sync_disabled` — migration
  `20261031000000_add_ebay_listing_sync_disabled`.

---

## 3. API layer

### 3.1 OAuth — `ebayClient.ts`
- `isEbayConfigured()` requires `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`,
  `EBAY_REFRESH_TOKEN`.
- `getClientToken()` — client-credentials grant, scope `api_scope`; cached and
  refreshed at 90% of `expires_in`.
- `getUserAccessToken()` — refresh-token grant with scopes `sell.inventory`
  and `sell.fulfillment`; cached at 90%. **All Sell API calls use this** (eBay
  rejects app tokens there).
- Host selection: `EBAY_ENV === 'production'` → `api.ebay.com`, else
  `api.sandbox.ebay.com`; token URL is `/identity/v1/oauth2/token`.

### 3.2 REST calls
| Function | Call | Notes |
| --- | --- | --- |
| `getOffersBySku(sku, marketplaceId)` | `GET /sell/inventory/v1/offer?sku=…` | filters `ACTIVE`/`PUBLISHED` |
| `updateInventoryItemQuantity(sku, qty)` | `GET` then `PUT /sell/inventory/v1/inventory_item/{sku}` | get-modify-write, preserves other fields |
| `updateOfferQuantity(offerId, qty)` | `GET` then `PUT /sell/inventory/v1/offer/{offerId}` | writes `availability.shipToLocationAvailability.quantity` |
| `getOrder(id)` | `GET /sell/fulfillment/v1/order/{id}` | throws on non-2xx/empty |
| `listOrdersSince(iso, limit)` | `GET /sell/fulfillment/v1/order` | `filter=creationdate:[…]`, sort creationdate, limit ≤ 200 |

`isRetryableError` (`ebayClient.ts` end): retryable for HTTP 5xx/429,
network/timeout keywords, and auth/token failures; everything else permanent.

### 3.3 Trading XML — `ebayTradingService.ts`
Single `tradingCall(callName, body)` posts XML with headers
`X-EBAY-API-CALL-NAME`, `X-EBAY-API-SITEID` (from `EBAY_SITE_ID`, default `0`),
compatibility level `967`, IAF token; 30 s timeout; parses with
`fast-xml-parser`, `parseTagValue: false` (numeric-looking SKUs keep leading
zeros). `Ack=Failure|PartialFailure` throws; `Warning` logs. Non-2xx → 502.

- `getActiveEbayListings({page, limit})` — `GetMyeBaySelling` `ActiveList`
  sorted `TimeLeft`, returns `listings`, `pagination {page, limit, total,
  totalPages}`, `fetchedAt`; attaches `linkedProduct` by item id first, then SKU.
- `getEbayItemDetails(itemId)` — `GetItem` with `DetailLevel=ReturnAll`,
  `IncludeItemSpecifics=true`; returns title, SKU, quantity, price/currency,
  URL, images, description HTML, category id/name, condition(+id), specifics,
  marketplace. Missing item → 404-shaped error.
- `reviseTradingQuantity(itemId, qty)` — `ReviseInventoryStatus`.

Parsing details:
- `money()` reads `#text` plus `@_currencyID`.
- `aggregateVariations()` sums `SellingStatus.QuantityAvailable` (fallback
  `Variation.Quantity`) across variations and returns the **lowest** price.
- `parseActiveItem` / `parseItemDetails` use the aggregate quantity/price when
  variations exist, else item-level `QuantityAvailable`/`Quantity` and
  `ConvertedCurrentPrice` → `CurrentPrice`.
- Marketplace is derived from the listing URL host (`ebay.co.uk` → `EBAY_GB`,
  `de/fr/it/es/ca/com.au`, default `EBAY_US`).
- Images: `GalleryURL` + item-level `PictureURL` + `ExternalPictureURL`, and —
  after the fix in §15 — **always** the per-variation `PictureURL` /
  `ExternalPictureURL`, deduped.

---

## 4. Catalog reconciliation sweep

`ebayCatalogAutoSync.ts`

- Interval: `EBAY_AUTOSYNC_INTERVAL_MS` (default `300000`), clamped to ≥60 s;
  first run 30 s after boot. `runAutoSyncTick()` refuses to overlap (returns
  `null`, admin route maps that to HTTP 409).
- Steps:

### 4.1 Walk
`walkActiveListings(marketplace)` (`ebayCatalogImportService.ts`) pages through
`GetMyeBaySelling` (≤100/page, ≤500 pages). Totals are re-read on every page;
an empty page mid-walk is retried up to 3× then throws 502; `complete` is true
when returned entries ≥ eBay total **or** all reported pages were fetched.
Result: `itemIds`, `totalEntries`, `returnedCount`, `listingsById`,
`skippedOtherMarketplace`, `complete`.

### 4.2 Mirror snapshot
All `ebay_listings` rows for the marketplace are loaded in 500-row pages
(`MIRROR_QUERY_CHUNK`) with their product (status, availability, prices, sale
window, stock, condition, notes, content fields) into `mirrorRows` keyed by
`ebayListingId`.

> This is deliberate and was fixed in §15: the row set must be the **whole
> marketplace**, because end-detection is defined as “mirror rows absent from
> the walk”.

### 4.3 New listings
`newIds = walk.itemIds` not present in `mirrorRows` → `enqueueCatalogImport`
(system job, `createdBy = null`; merges into an active system job) then
`processEbayImportJobs()` is kicked immediately.

### 4.4 Ended / reactivated (only when `walk.complete`)
- Row loaded but id absent from the walk and `status !== 'ended'` → `ended`,
  `lastError` set. For mirror mode **or** products whose `internalNotes` start
  with `Imported from eBay`, availability flips to `out-of-stock` (archived
  products excluded).
- Row present in walk but `status === 'ended'` → back to `synced`,
  `lastSyncedQty = null`, error cleared; imported rows get availability
  restored from current central stock.
- If more than `ENDED_PER_SWEEP_CAP = 200` rows would end in one sweep, the
  whole end/reactivation pass is skipped and recorded as `endedSkipped`.

### 4.5 Price / stock / condition imports
Scope: imported products (`internalNotes` prefix) or every row in mirror mode;
archived/ended/absent rows skipped.

- **Condition**: if the walk carried a condition, `planConditionUpdate` decides
  the write (maps display name or numeric id).
- **Deep targets**: mirror mode → every in-scope row; otherwise only rows whose
  walk entry carried no condition.
- **Stock** (only when mirror row `status === 'synced'` and a walk entry
  exists): if `ebayQty !== lastSyncedQty && ebayQty !== product.stockCount` →
  write `stockCount` + availability and update `lastSyncedQty/lastSyncAt`.
- **Price**: if an eBay price exists and (no active site sale window OR mirror
  mode): write `regularPrice` when it differs by ≥0.01; in mirror mode also
  clear `salePrice/saleStartsAt/saleEndsAt` when a sale exists.

### 4.6 Deep GetItem pass (rotating)
Budget `EBAY_MIRROR_GETITEM_BUDGET` (default 40, 1–200) per sweep; targets are
sorted by listing id and selected from a module cursor
(`conditionRefreshCursor`), so the catalog rotates. Per target:
`getEbayItemDetails` → `planConditionUpdate` → in mirror mode
`syncFullEbayProduct` (content + specs + photos). Failures log and are retried
next sweep; they never abort the sweep.

### 4.7 Summary & audit
Every sweep records `AutosyncSweepSummary` in memory (`getLastAutoSyncSummary`)
and writes audit action `catalog.autosync` when anything changed or errored.

---

## 5. Import pipeline

### 5.1 Job API (`ebayCatalogImportService.ts`)
- `startEbayCatalogImport({marketplace, actor})` — 503 when unconfigured, 400 for
  non-`EBAY_US`, 409 when an import is queued/running. Creates a job with
  `createdBy = actor.id` and kicks the runner.
- `enqueueCatalogImport(itemIds, marketplace)` — dedupes ids, merges into an
  active system job (cursor preserved), else creates a system job. 503/400
  guards.
- `getEbayCatalogImport`, `getLatestEbayCatalogImport`, `cancelEbayCatalogImport`
  (no-op for finished jobs), `serializeImportJob` (omits `itemIds`, adds
  `remaining`).
- Scheduler: `startEbayCatalogImportScheduler(5000)` — first tick after 5 s,
  then every 5 s; `processEbayImportJobs` is single-flight.

### 5.2 Worker (`processJob`)
1. Skips while a per-job backoff is active (`pausedUntil`, 60 s after a
   transient error).
2. If no `itemIds`, discovers via `walkActiveListings`; a cancel during
   discovery stops before persisting. Empty discovery → `completed` + audit.
3. Loads categories/brands (`loadLookup`) and all existing `seoTitle`s for
   uniqueness.
4. Processes `batchSize()` items (`EBAY_IMPORT_BATCH_SIZE`, default 4, 1–25),
   persisting cursor/counters after **each** item and checking for cancellation.
5. Transient errors abort the batch without advancing the cursor (same item
   retried after 60 s). Permanent errors increment `failed`.
6. Completing marks `completed`, `finishedAt`, clears `lastError` when no
   failures, and writes `product.import.ebay` audit.

### 5.3 `importOne(itemId, marketplace, jobId, lookup, actorId, usedSeoTitles)`
- Already-mapped `ebayListingId` → `skipped`.
- `GetItem`; marketplace mismatch → `skipped`.
- Title cleaned (≤500); SKU = trimmed eBay SKU or `EBAY-<itemId>` (≤100).
- Existing website product with that SKU → create a `sync-pending` mirror row
  (`lastSyncedQty: null`, explanatory `lastError`) and return `linked`; if a
  mapping already exists, log and return `linked` (one row per SKU+marketplace).
- New product: `normalizeProductContent` (name, condition, identity, plain-text
  description, specs, category name), unique SEO title, price (0 when unknown),
  stock = `max(0, floor(quantity))`, unique slug (product + slug-history aware),
  category via `resolveCategoryId`, brand via normalized manufacturer match,
  `status: draft`, `lastVerifiedAt` untouched, `internalNotes` trace.
- Writes product spec rows, mirrors images, then if `autoPublishEnabled()` and
  `isProductPublishable()` passes → `published` + `contentUpdatedAt` + audit
  `product.publish.auto` + per-job published tally; otherwise logs gate reasons.
- Creates the mirror row `status: synced`, `lastSyncedQty = stockCount`.
- Returns `created | linked | skipped | failed`.

`importSingleEbayItem(itemId, marketplace, actor)` reuses `importOne` with a
synthetic job id, audits `ebay.item.import`, and returns the product id.

### 5.4 Auto-publish flag
`autoPublishEnabled()` = module override (admin) else
`EBAY_AUTO_PUBLISH !== '0'`; source reported by `autoPublishSource()`;
setter `setEbayAutoPublishOverride`.

### 5.5 Image mirroring (`mirrorProductImages`)
- Desired = deduped non-empty URLs, capped by `maxImportImages()`
  (`EBAY_IMPORT_MAX_IMAGES`, default 24).
- Plan from `planImageSync`: keep rows whose **provenance** (`sourceUrl` ??
  `url`) is still listed; add missing; delete vanished.
- One keeper per desired photo; duplicate legacy rows are deleted.
- Order of writes (unique `(productId, sortOrder)`): delete removals → park
  keepers at negative sort orders (`-(1000 + index)`) with `isMain=false` →
  download+upload new photos (best-effort; failures skip that photo) and create
  them at their final index → settle keepers at final index/main/alt/sourceUrl.
- OG image set to photo #0 when it changes; cleared when the listing has zero
  photos.
- Returns `{added, removed, mainUrl}`.

`syncFullEbayProduct({product, details})` re-normalises content, writes only
changed fields via `contentPatch` (name, description, short description,
keyFeatures, includedItems, manufacturer, modelNumber, mpn — never slug/SKU/
category/brand/SEO title), replaces specs only when the order-sensitive
signature changed, mirrors images, and returns
`{changed, contentUpdated, specsUpdated, imagesAdded, imagesRemoved}`.

### 5.6 One-shot photo backfill
`ebayImageBackfill.ts` snapshots every non-ended, non-archived mapped listing
for the marketplace, then processes `EBAY_IMAGE_BACKFILL_BATCH` (default 4,
1–12) per `EBAY_IMAGE_BACKFILL_TICK_MS` (default 10 s, 5–120 s). Each item:
`GetItem` → `mirrorProductImages`. Transient failures re-queue up to 2 times.
Job state is in-memory, cancellable; `GET` returns the last job. Scope is
photos only.

---

## 6. Category mapping

`ebayCategoryMapping.ts` (pure). `resolveWebsiteCategory(input)` returns
`{slug, confidence, reason}` and never null; site slugs are the constant
`SITE_CATEGORY_SLUGS`. Confidence order:
`ebay-category-id` > `ebay-category` > `keyword` > `fallback`.

1. **Pin** on `categoryId`: admin overlay first, then `EBAY_CATEGORY_ID_MAP`.
2. **Category name**, leaf-first over `:`-split segments, `Other …` segments
   skipped: alias table match; special case — an alias resolving to `electrical`
   for a segment containing “tools” is overridden by a hand-tool keyword hit in
   the title; otherwise category-name keyword rules.
3. **Content keywords**: title first, then item specifics, against
   `CATEGORY_KEYWORD_RULES` in declaration order (most specific first).
4. **Fallback** `other-business`.

Matching: text normalized (lowercase, `&`→`and`, non-alphanumerics → spaces);
phrase regex anchored on word boundaries, plural-tolerant on the final word.
`categoryIdForSlug(slug, categories)` → matching row id → fallback row id →
`null`.

Admin pins: `applyCategoryPins(map)` replaces the overlay after validating
slugs (`invalid` returned), `activeCategoryPinFor`, `activeCategoryPins`
(admin → env with `admin-overrides-env` marker), `adminCategoryPinCount`.
Env map is parsed once at module load and warns on invalid JSON/slugs.

Import trace written to `products.internal_notes`:
`Imported from eBay item … — eBay category: …. Category assigned: <confidence>
→ <slug> (<reason>).`

### Offline recategorisation — `scripts/recategorizeFromEbay.ts`
Reads products (scope `imported` default, `uncategorized`, `all`, optional
`--sku`), parses the eBay category from `internalNotes`
(`eBay category: …` up to `. Category assigned:` / sentence end), re-runs the
rules with product name + specs, clamps proposals to categories that exist,
and applies: equal → kept; confident or uncategorized or `--force` → write
(with a remap trace appended); fallback on an already-categorised product →
`kept-current`. Reports JSON+CSV to `../reports/category-remap-YYYY-MM-DD.*`;
`--apply` writes.

---

## 7. Orders and notifications

### 7.1 Webhook — `routes/webhooks/ebay.ts`
- `GET /api/webhooks/ebay?challenge_code=…` and the same probe on `POST`
  answer `{challengeResponse}` from `buildChallengeResponse`
  (`sha256(code + EBAY_VERIFICATION_TOKEN + EBAY_PUBLIC_ENDPOINT)` hex); missing
  code/env → 400.
- `POST` otherwise extracts topic/event id (`ebayOrderEvents.ts` supports the
  real EPN envelope `metadata.topic`, `notification.notificationId`,
  `notification.data.orderId` and flat fallbacks), responds 200 immediately and
  processes asynchronously. Missing event id uses `<topic>:<Date.now()>`.
- `GET /events` (admin auth) returns the last 50 log rows.

### 7.2 Processing — `ebayOrderService.ts`
- **Idempotency**: `ebay_event_log.create` unique event id. Duplicate insert is
  a no-op unless the existing row is `received` (a retry of a deferred event).
- Order claim: `ebayOrder.create({status:'processing'})`; on conflict retry
  `failed`/`ignored` or `processing` older than 10 minutes.
- Re-fetches the order from the Fulfillment API (`fetchOrder` injectable).
  Retryable failure → release claim to `failed`, event stays `received`,
  returns `deferred`. Permanent → event `failed`.
- Non-`PAID` orders → `ignored` (no stock).
- Line items matched by SKU candidates (raw, trimmed, whitespace-collapsed):
  mirror row first, else product by SKU, else case-insensitive product search.
  Eligibility: `sellableOnEbay(product, listing)` — any non-archived product
  with a mirror row, else published-only.
- Unit price = buyer’s `lineItemCost/quantity` when present, else catalog sale
  price if active and lower, else regular price.
- Creates internal `orders` row: `paid`, `paymentMethod: 'ebay'`,
  `paymentStatus: 'paid'`, subtotal from lines, total from eBay (fallback
  subtotal), `customerNotes: '[ebay:<orderId>]'`.
- Claims every line through `decreaseStock(productId, qty, 'ebay', {orderId})`;
  on any failure it restores already-claimed units with `increaseStock`, deletes
  items/timeline/order, marks `EbayOrder` and event `failed`.
- Success: timeline row (`paid`, note), `EbayOrder` `processed` + internal
  order id, event `processed`.

### 7.3 Retries and gap-filling
- `retryPendingEvents(maxAgeMinutes=1440)` reprocesses up to 50 `received`
  events.
- `pollEbayOrders(hoursBack=72)` lists Fulfillment orders since the timestamp
  and processes each unprocessed order under event id
  `poll:<orderId>:<hourBucket>`, so failures can retry hourly while processed
  orders stay untouched.

---

## 8. Quantity sync (website → eBay)

`ebaySyncScheduler.ts`
- Jobs every 10 min (first after 90 s, non-overlapping): `pollRecentOrders` →
  `syncPendingListings` → `reconcileEbayQuantities` → `retryDeferredEvents`.
- `syncPendingListings` takes up to 50 `sync-pending`, `syncDisabled=false`
  rows ordered by `updatedAt`.
- `attemptQuantityPush`: archived → `sync-failed` (skipped); no offer id and no
  item id → `sync-failed`; offer id → `updateOfferQuantity`, else
  `reviseTradingQuantity`. Success → `synced`, `lastSyncedQty`, `lastSyncAt`,
  error cleared. Failure: message matching `/variation/i` → `synced` with the
  central qty recorded and item-level pushes skipped (variations are
  eBay-owned); retryable → `sync-pending`; otherwise `sync-failed`. Central
  stock is never rolled back.
- `reconcileEbayQuantities`: all rows with status `synced|published|sync-failed`
  and `syncDisabled=false`, non-archived; `lastSyncedQty !== stockCount` →
  `sync-pending` with a drift message.
- `requestSyncTick()` is called by `centralInventory.enqueueEbayQuantitySync`
  after every stock change; it runs a push-only pass and coalesces bursts into
  one debounced follow-up 5 s later.
- `syncNow()` (admin route) runs order poll + push + reconcile and returns
  `{synced, failed, skipped, driftFound, ordersPolled}`.

Pause semantics: `syncDisabled` removes the row from push and reconciler
scopes; ended/import tracking still applies.

---

## 9. Runtime overrides

`ebayAdminRuntime.ts` stores three `StoreSetting` rows:
- `ebay.fullMirror` → `setEbayMirrorOverride`
- `ebay.autoPublish` → `setEbayAutoPublishOverride` (dynamic import)
- `ebay.categoryPins` → `applyCategoryPins`

`loadEbayAdminRuntime()` runs at boot; failures are logged and env defaults
remain. `setEbayRuntimeFlag(key, value|null, actor)` deletes the row for `null`
or upserts, applies the override, audits `ebay.flag.update`.
`setEbayCategoryPins(pins, actor)` applies, deletes the row when nothing
applies, caches, audits `ebay.category.pins.update`.

Mirror mode (`ebayMirror.ts`): `mirrorModeEnabled()` = override ?? env
`EBAY_FULL_MIRROR` (`1/true/yes/on`); `deepSyncBudget()` clamps
`EBAY_MIRROR_GETITEM_BUDGET`.

---

## 10. Listing creation

`ebayListingService.createListingForProduct` (admin route `POST /listings`):
- Requires configured credentials and all four account env values
  (`EBAY_MERCHANT_LOCATION_KEY`, fulfillment/payment/return policy ids),
  otherwise 503 listing missing keys.
- Product must exist and be `published`; price = override or effective price,
  must be > 0. Currency = product currency when 3-letter, else `USD`.
- Upserts the mirror row by `sku+marketplace` (`pending`) — idempotent.
- `PUT inventory_item/{sku}` with central quantity, mapped condition
  (`new/unused→NEW`, `refurbished/reconditioned→REFURBISHED`, else
  `USED_EXCELLENT`), title ≤80, description ≤4000, up to 24 http(s) images,
  aspects Brand/MPN.
- Creates the offer (or updates it) with `FIXED_PRICE`, category id, pricing
  summary, merchant location and the three policy ids.
- Publishes when no listing id yet; “already published” is tolerated, other
  publish failures stored in `lastError` and the row remains `published`.
- Re-pushes central quantity to the inventory item (best-effort) and the offer;
  row becomes `synced` when a listing id exists, else `published`.
- Category + aspect source (since the GraphQL listing previews landed): the
  admin-typed id wins; otherwise the latest `ok` preview row for the product
  supplies the recommended category id and PREFILL item aspects (HINT values
  and seller-set Brand/MPN are never overwritten). No preview and no id → 400
  with the remedy. Applied previews are marked `applied`.

### 10.b Listing previews (GraphQL Inventory Mapping API, Oct 2026)

`ebayListingPreviewsService.ts` + pure helpers `ebayListingPreviewsPure.ts`;
routes `POST /admin/ebay/listing-previews/run` (body ≤10 product ids),
`GET .../tasks`, `GET .../tasks/:id`. Accepted scope
`https://api.ebay.com/oauth/api_scope/sell.inventory.mapping` via the
separate-cache `getMappingUserAccessToken()` (re-mint refresh token, MANUAL_TASKS
MT-24). Batch of published products without a live listing (≤ `EBAY_PREVIEW_BATCH`,
default 10 — eBay's documented mutation maximum) → `startListingPreviewsCreation`
(`StartListingPreviewsCreationInput`, `externalProducts`; X-EBAY-C-MARKETPLACE-ID:
EBAY_US; external products carry sku, title≤250, `categoryName` leaf name or
`/root/…/leaf` path, https-only images ≤24, Brand/MPN aspects, **no**
`externalProductIdentifierInput` — GTIN-only UPC|ISBN|EAN and MPN is unsupported)
→ `listingPreviewsCreationTaskById` poll; results flatten into
`ebay_listing_previews` (category id/name/level, ePID, `mapping_reference_id`,
suggested title, aspects JSON, outcome `ok|unprocessed|unmapped|invalid`).
`unmapped` must not be retried; `unprocessed` is retriable (per-product Retry in
the Hub). Full details: `docs/ebay-listing-previews.md`. The two GraphQL document
constants at the top of the service mirror the documented schema; the gateway is
UNVERIFIED until the first sandbox/production run (type names now come verbatim
from the docs — a validation error would name the field to fix).

---

## 11. Admin HTTP API (`routes/admin/ebay.ts`)

All routes require admin auth; `inventory-manager` role is required for writes
(role hierarchy in `middleware/auth`).

| Method / path | Behaviour |
| --- | --- |
| `GET /inventory?page&limit` | Products (non-archived) + mirror rows; paginated |
| `GET /active-listings` | Live `GetMyeBaySelling` page; 502 on Trading errors |
| `POST /inventory/sync-now` | `syncNow()` |
| `POST /listings` | `{productId uuid, categoryId, price?, marketplace?}` → create offer |
| `POST /catalog-import` | `{marketplace?}` → job (202) |
| `GET /catalog-import/latest?marketplace` | latest job |
| `GET /catalog-import/:id` | job by uuid |
| `POST /catalog-import/:id/cancel` | cancel queued/running job |
| `POST /catalog-autosync/run` | force sweep; 409 if one is running |
| `GET /catalog-autosync/status` | last sweep, latest job, auto-publish flag, status counts |
| `GET /catalog-images-backfill` | current/last image job |
| `POST /catalog-images-backfill` | start job (202) |
| `POST /catalog-images-backfill/cancel` | cancel running job (400 if none) |
| `GET /hub/overview` | connection, flags, counts, drift, last runs, problems |
| `GET /hub/listings?status&marketplace&paused&search&page&limit` | rows + counts + marketplaces |
| `POST /hub/listings/:id/pause` | `{disabled: boolean}`; audit |
| `POST /hub/listings/:id/push-quantity` | `pushListingNow` |
| `POST /hub/listings/:id/resync` | content/specs/condition/photos refresh |
| `POST /hub/listings/:id/reapply-category` | re-run rules, apply, trace |
| `GET /hub/unimported-listings?pages` | walk active listings, return those without a mirror row (≤200) |
| `POST /hub/unimported-listings/:itemId/import` | `{marketplace}` → import |
| `GET /hub/orders`, `POST /hub/orders/:ebayOrderId/retry` | order log + reprocess |
| `GET /hub/events`, `POST /hub/events/:eventId/retry` | notification log + reprocess |
| `GET /hub/settings`, `PUT /hub/settings` | flags + pins + categories + limits |

Service errors carry `{status}`; `sendServiceError` forwards it, default 500.

---

## 12. Admin frontend

### 12.1 eBay Hub — `/admin/ebay` (`AdminEbayHub.tsx`)
Tabs: Overview, Listings, eBay Orders, Webhooks, Settings. Page actions (role
`owner|store-manager|inventory-manager`): “Sync quantities”, “Run catalog
sweep”, “Inventory sync” link.
- Overview: connection + business-policy readiness, runtime flags/source, the
  three schedules, 10 health counters (mapped, paused, sync-failed, quantity
  drift, ended-but-in-stock, mapped products without images, drafts live on
  eBay, imported/total products, failed orders, failed events), last sweep /
  import job / image backfill, and the three failure lists. Buttons start a full
  import or photo backfill.
- Listings: status chips with counts, pause-state and marketplace filters,
  search, table with product/site status, item link, central vs pushed qty
  (drift highlighted), price + sale, photo count, last sync/error; per-row
  Pause/Resume, Push qty, Re-sync, Category. Below: “List a product on eBay”
  (published-product search, numeric category id, optional price) and “Live on
  eBay, missing from the site” (scan + one-click import).
- Orders: status chips, search, internal order link, total, status, processed
  time, error, retry.
- Webhooks: status chips, topic/event id, error, collapsible payload preview,
  retry.
- Settings: per-flag Inherit/Force ON/Force OFF selects, category pin
  add/remove (env pins read-only), read-only env limits.

### 12.2 eBay Inventory — `/admin/ebay-inventory` (`AdminEbayInventory.tsx`)
Sync-now, catalog import start/cancel with progress polling (3 s, resumes from
`latestCatalogImport` after reload), image backfill start/cancel with progress
polling, products table with central stock vs `lastSyncedQty`, mirror status
badge/error, and the live active-listings table (item image, title, price with
original currency, qty, marketplace, linked product) with pagination.

### 12.3 Client
`src/lib/api/admin.ts` → `admin.ebay.*` mirrors every route above with typed
responses (`EbayHubOverview`, `EbayHubListingsResponse`, `EbayHubOrdersResponse`,
`EbayHubEventsResponse`, `EbayHubSettings`, `EbayImportJob`,
`EbayImageBackfillJob`, `EbaySweepSummary`, `ActiveEbayListingsResponse`, …).

### 12.4 Navigation
`adminNav.ts`: Operations → eBay Hub (`/admin/ebay`, icon Activity) and eBay
Inventory (`/admin/ebay-inventory`, icon Store), both visible to all admin
roles; routes registered in `App.tsx` and reached through `AdminGuard`.

---

## 13. Environment variables (defaults from code)

| Variable | Default | Read in |
| --- | --- | --- |
| `EBAY_ENV` | `sandbox` | client host + Trading endpoint + listings |
| `EBAY_SITE_ID` | `0` | `X-EBAY-API-SITEID` |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_REFRESH_TOKEN` | — | `isEbayConfigured`, OAuth |
| `EBAY_MERCHANT_LOCATION_KEY`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID` | — | listing creation preflight |
| `EBAY_PUBLIC_ENDPOINT`, `EBAY_VERIFICATION_TOKEN` | — | webhook challenge |
| `EBAY_AUTOSYNC_INTERVAL_MS` | `300000` (min 60000) | sweep scheduler |
| `EBAY_AUTO_PUBLISH` | `1` (anything else except `0` is ON) | auto-publish |
| `EBAY_CATEGORY_ID_MAP` | `{}` | env category pins |
| `EBAY_IMPORT_MAX_IMAGES` | `24` (1–24) | image mirror |
| `EBAY_FULL_MIRROR` | off | mirror mode |
| `EBAY_MIRROR_GETITEM_BUDGET` | `40` (1–200) | deep pass |
| `EBAY_IMPORT_BATCH_SIZE` | `4` (1–25) | import worker |
| `EBAY_IMAGE_BACKFILL_BATCH` | `4` (1–12) | photo backfill |
| `EBAY_IMAGE_BACKFILL_TICK_MS` | `10000` (5000–120000) | photo backfill |

---

## 14. Logs and audit markers

- `EBAY_AUTOSYNC` — every sweep line incl. the `sweep summary` object.
- `eBay catalog import:` — per item outcome (auto-published / stays draft +
  reasons / failed).
- `EBAY_IMAGE_BACKFILL` — start/finish/failure.
- Audit actions: `catalog.autosync`, `product.import.ebay`,
  `product.publish.auto`, `ebay.item.import`, `ebay.listing.resync`,
  `ebay.listing.reapply-category`, `ebay.order.retry`, `ebay.event.retry`,
  `ebay.flag.update`, `ebay.category.pins.update`, `ebay.images_backfill`.
- `GET /admin/ebay/catalog-autosync/status` exposes `lastSweep` and
  `autoPublishEnabled` without log access.

---

## 15. Defects found and fixed in this pass

All fixes are code-driven; each was verified by typecheck/tests/build.

1. **Ended-listing detection could never run.**
   `ebayCatalogAutoSync.ts` loaded mirror rows with
   `where: { marketplace, ebayListingId: { in: walk.itemIds } }`, so
   `mirrorRows` only ever contained ids that were present in the walk.
   The subsequent loop `if (!activeIdSet.has(listingId)) → ended` was therefore
   unreachable, and ended listings were never flagged (`endedButInStock` could
   never drop). Fixed by paging **all** mirror rows for the marketplace
   (500-row pages) before the diff; active rows still gate the price/stock/
   content loops through `activeIdSet`.
2. **Variation listings lost most photos.**
   `ebayTradingService.parseItemDetails` merged per-variation pictures only
   when the item-level image array was empty. Item-level `GalleryURL` is
   normally present, so only one photo was imported. Variation photos are now
   always appended and deduped.
3. **eBay Inventory page badges were unstyled.**
   `AdminEbayInventory.tsx` used `admin-badge published/draft/cancelled/…`
   classes that do not exist (definitions are `admin-badge-*`). The status map
   and three inline badges now use `admin-badge-published/-info/-danger/
   -draft/-hidden`; `ended` added.
4. **eBay Inventory page buttons were unstyled.**
   Every action used `.admin-btn`, which had no CSS definition. Added a themed
   `.admin-btn` (+ hover/disabled) to `src/admin.css`.
5. **Double page padding.**
   `AdminEbayInventory` wrapped itself in `p-6` inside the admin shell’s own
   padded `<main>`, producing 48px gutters; the extra padding was removed.
6. **Listing currency hardcoded to USD.**
   `createListingForProduct` always sent `pricingSummary.price.currency =
   'USD'`. It now uses the product currency when it is a valid 3-letter code,
   else USD, and selects `currency` from the product row.

### Verified

- `backend: npx tsc --noEmit` → 0
- root `tsc -b --noEmit` → 0
- `npm --prefix backend test` → 236/236 pass
- No unit tests cover the auto-sync DB diff (it needs Prisma); the ended-fix
  is verified by reading the query scope and by the unchanged summary logic.

---

## 16. Known risks / not verified here

- No live eBay sandbox/production call was made: OAuth scopes, offer PUT
  payload shape, Trading XML acceptance and publish requirements are verified
  only against the code paths and the existing unit tests.
- `updateOfferQuantity` sends a minimal PUT body (`sku`, `marketplaceId`,
  `format`, `availability`); eBay has historically required a fuller offer
  document for some listing types. If pushes fail with 4xx validation errors,
  extend that payload (the failure is recorded on the mirror row and retried).
- Auto-sync and the Hub depend on Prisma integration (no unit coverage); the
  scheduler overlap guards are in-memory, so multi-instance deployments would
  need a DB-level lock.
- `EBAY_FULL_MIRROR` mode intentionally overwrites admin edits for synced
  fields; while it is ON, admin price/content edits are not durable.
