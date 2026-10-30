# eBay catalog sync

Last updated: 2026-10-29

How the website catalog stays in step with the seller's eBay store, and how to
diagnose it when a listing does not appear.

## The pipeline

```
eBay ActiveList (GetMyeBaySelling)
        │  every EBAY_AUTOSYNC_INTERVAL_MS (default 5 min)
        ▼
sweepEbayCatalogAutoSync()          backend/src/services/ebayCatalogAutoSync.ts
  1. walk every page of ActiveList        (hardened: totals re-read per page,
  2. diff against the ebay_listings        transient empty pages retried,
     mirror                                incomplete walks never end rows)
        │                                 ▼
        ├─ new item ids          → incremental import job (createdBy = null)
        │                          → processEbayImportJobs starts immediately
        │                                 ▼
        │                          importOne(itemId)                  (ebayCatalogImportService.ts)
        │                            resolves website category        (ebayCategoryMapping.ts)
        │                            mirrors images, prices, stock
        │                            isProductPublishable gate        (productMutations.ts)
        │                                 ▼
        │                          auto-publish when the gate passes
        │                          (draft + reason logged when not)
        │
        ├─ mirror row missing from a COMPLETE walk → listing ended:
        │    ebay_listings.status = 'ended';
        │    products imported from eBay flip to out-of-stock (product page
        │    stays live; a re-listed item is restored by the next sweep).
        │
        ├─ eBay price/stock update on an eBay-imported product → imported
        │    (prices outside sale windows; stock guarded by lastSyncedQty so
        │    the website→eBay reconcile keeps locally-changed stock).
```

Guarantees:

- **A listing that meets the configured criteria (all active EBAY_US listings
  on the account) appears on the website within ~5 minutes** of being listed,
  because the sweep runs every 5 min and enqueues an import that is kicked
  immediately. Publish-gate failures are the only path that stays a draft, and
  they are logged with the exact reasons.
- **No valid listing is silently dropped.** The ActiveList walk re-reads
  eBay's totals on every page, retries transient empty pages, and *fails
  loudly* (HTTP 502-class error, logged, sweep summary `error`) instead of
  quietly skipping a page. End-detection only runs when the walk came back
  complete, so a truncated walk cannot false-flag live listings as ended.
- **No duplicates**: imports dedupe by eBay item id + normalized SKU; sweep
  enqueues merge into one system-owned job (`createdBy = null` on
  `ebay_import_jobs`) rather than stacking jobs per sweep.
- **Ended listings** are marked, not deleted — `ebay_listings.status='ended'`
  and the product page stays online (SEO preserved). The mirror row is what
  the next sweep uses to re-activate a re-listed item.

## Category assignment

`backend/src/services/ebayCategoryMapping.ts` assigns one of the website
category slugs for every listing, in priority order:

1. **`EBAY_CATEGORY_ID_MAP` pin** — env JSON, eBay leaf category id → site
   slug. Wins over everything; used to correct specific eBay leaf categories
   that keywords cannot disambiguate.
2. **eBay category-name aliases** — the store's own category mirror names plus
   common eBay taxonomy leaf names (e.g. "Electrical & Automation",
   "Engine Components").
3. **Ordered keyword rules** over the listing title, then item specifics —
   most specific first ("Rexroth A10VSO … pump" → `hydraulic-pumps`, not the
   generic `hydraulic`).
4. **Fallback `other-business`** — the catalog's existing catch-all. A product
   is never left uncategorized.

Every assignment records a trace in `products.internal_notes`:

```
Imported from eBay item 1234 (EBAY_US) — eBay category: Industrial Electrical Equipment.
Category assigned: ebay-category → electrical (eBay category name "Industrial Electrical Equipment" → keyword alias "electrical" → electrical).
```

Confidence levels: `ebay-category-id` (pin) > `ebay-category` (category-name
alias) > `keyword` (title/specifics) > `fallback`.

### Correcting the existing catalog

The importer applies this mapping to new imports. For the catalog already
imported, run the audit script
(`backend/src/scripts/recategorizeFromEbay.ts`) — dry run by default — to
remap existing products with the same rules:

```bash
# dry run — writes reports/category-remap-YYYY-MM-DD.{json,csv} only
npx tsx src/scripts/recategorizeFromEbay.ts

# commit the proposed changes
npx tsx src/scripts/recategorizeFromEbay.ts --apply

# also override products that currently have a category the rules disagree with
npx tsx src/scripts/recategorizeFromEbay.ts --force --apply

# only one SKU
npx tsx src/scripts/recategorizeFromEbay.ts --sku "F 32" --apply
```

A confident recomputation always wins; an unresolvable product keeps the
category it already has (listed as `kept-current` in the report) unless
`--force` is given. Uncategorized products receive the fallback when needed.

## Admin controls & diagnosis

### eBay Hub (`/admin/ebay`)

The tabbed hub is the control surface for the whole channel. It reads through
`backend/src/services/ebayHubService.ts`; every write is audited.

| Tab | What it shows / does |
| --- | --- |
| Overview | Connection + business-policy readiness, effective behaviour flags, all listing/order/event counts, quantity drift, ended-but-in-stock (oversell) count, mapped products with no photos, drafts selling on eBay, last sweep / import / image job, scheduled intervals, and the last failed listings, orders and notifications. |
| Inventory sync | Central stock beside every eBay mirror row (drift highlighted), **Sync now**, the catalog import job with progress and cancel, the photo-backfill job with progress and cancel, and the active eBay listings pulled live through the Trading API. Merged from the retired `/admin/ebay-inventory` page — that URL now redirects to `/admin/ebay?tab=inventory`, and the tab lives in the URL so it is bookmarkable. |
| Listings | Every `ebay_listings` mirror row with product status, central vs last-pushed quantity (drift highlighted), website price, photo count, last sync and error. Filters by status/pause state/search. Per-row repairs: pause/resume the website→eBay direction, push quantity now, re-sync copy + item specifics + condition + photos from eBay, and re-apply the category rules (so a pin/keyword fix also repairs products imported before it). Below it, **List a product on eBay** creates/updates an Inventory API offer for a published product with quantity pinned to central stock, and **Live on eBay, missing from the site** walks the active listings and lists every item with no mirror row so it can be imported in one click. |
| eBay Orders | `ebay_orders` rows with the internal order link, status, error and retry (re-runs the idempotent processor — the fix path after mapping a missing SKU). |
| Webhooks | `ebay_event_log` deliveries with status, error, payload preview and retry. |
| Settings | Force ON/OFF or inherit `ebay.fullMirror` and `ebay.autoPublish` (persisted in `store_settings`, applied without a redeploy), edit the admin category-pin table, and see the read-only env limits. |

Pause (`syncDisabled`) stops only website→eBay writes. eBay→website tracking —
imports, price/stock imports and ended detection — stays on, so a paused row
can still be flagged ended.

### Routes

Routes on `/api` (admin auth, inventory-manager role for the run):

| Route | Purpose |
| --- | --- |
| `POST /admin/ebay/catalog-autosync/run` | Force a sweep outside the 5-min schedule. |
| `GET  /admin/ebay/catalog-autosync/status` | Last sweep summary, last import job, `autoPublishEnabled`, per-status mirror counts. |
| `POST /admin/ebay/catalog-import` | Manual full import of all discovered active items. |
| `GET  /admin/ebay/catalog-import` / `/:id` | Inspect import jobs (same data the autosync path creates). |
| `POST /admin/ebay/listing-previews/run` | Start a GraphQL *listing previews* task (eBay category/aspects/ePID suggestions for unpublished products). Scope MT-24 required; see `docs/ebay-listing-previews.md`. |
| `GET  /admin/ebay/listing-previews/tasks` / `/:id` | Poll a previews task (id = live-poll while running) + per-product results. |
| `GET  /admin/ebay/hub/overview` | Hub health payload (see Overview tab). |
| `GET  /admin/ebay/hub/listings` | Filtered mirror rows + status/marketplace counts. |
| `POST /admin/ebay/hub/listings/:id/pause` | Pause (`{disabled:true}`) or resume the website→eBay direction. |
| `POST /admin/ebay/hub/listings/:id/push-quantity` | Push this row's central stock now. |
| `POST /admin/ebay/hub/listings/:id/resync` | Re-sync content, specifics, condition and photos from eBay. |
| `POST /admin/ebay/hub/listings/:id/reapply-category` | Re-run the category rules for one listing and apply the result (trace stored in `internal_notes`). |
| `GET  /admin/ebay/hub/unimported-listings` | Walk active listings and return those with no mirror row. |
| `POST /admin/ebay/hub/unimported-listings/:itemId/import` | Import one listing (idempotent; links an existing SKU). |
| `GET  /admin/ebay/hub/orders` / `POST .../:ebayOrderId/retry` | Inspect and reprocess eBay orders. |
| `GET  /admin/ebay/hub/events` / `POST .../:eventId/retry` | Inspect and reprocess notifications. |
| `GET` / `PUT /admin/ebay/hub/settings` | Read and save behaviour overrides + category pins. |

Behaviour overrides (`ebay.fullMirror`, `ebay.autoPublish`, `ebay.categoryPins`)
are loaded into memory at boot by `loadEbayAdminRuntime()`, so the sweep/import
hot paths keep reading plain module flags. Deleting a setting restores the env
default.

## Logs

Every auto-sync line is tagged so ops can grep a single string in Railway:

- `EBAY_AUTOSYNC` — per-sweep: what was found, imported, ended, re-priced,
  plus the one-line `sweep summary` object (walk complete? counts, duration,
  error). Grep this first.
- `eBay catalog import:` — per product: tracked/duplicate/price-changed/
  **auto-published**/**stays draft (with gate reasons)**/failed.
- `catalog.autosync` — audit-log action with the full sweep summary (visible
  in the admin audit log).

The sweep summary is also returned by
`GET /admin/ebay/catalog-autosync/status` → `lastSweep`, so "is it working?"
answers without touching logs.

## Full mirror mode (`EBAY_FULL_MIRROR=1`)

By default the sweep only syncs price/stock/condition for products **this
catalog imported from eBay**, admins keep full editorial control over the
rest, and listing content (photos, title, description, item specifics) is
imported once and never revisited.

Mirror mode turns the eBay → website direction into a live one-way mirror:

| eBay change | Site effect | Latency |
| --- | --- | --- |
| New listing | Imported + auto-published (existing behavior) | one sweep |
| Price change (incl. running a sale/markdown) | `regularPrice` mirrors eBay; a stale site-side sale window is **cleared** so the displayed price matches eBay | one sweep |
| Quantity change | Stock + availability follow eBay (existing guard: eBay-on-change only). Multi-variation listings: the item itself is stock-push-locked on eBay, so the summed variation quantity is imported eBay → website and item-level pushes are skipped instead of retry-looping | one sweep |
| Condition change | Condition synced | one sweep |
| Photos added/removed/reordered | Cloudinary set re-mirrored; image #0 stays main/OG | ≤ one full rotation of the GetItem window (default about 4 rows per 5-minute sweep → ~23 h for ~1,100 listings; the budget is capped to reserve eBay Trading API calls for imports, backfill and order work) |
| Title / description / item specifics revised | Site copy + spec rows re-synced (slug, SKU, category, brand and SEO title untouched); variation listings aggregate min price / summed quantity / per-variation photos | ≤ one rotation |
| Listing ended | Product flips out-of-stock — even admin-authored linked rows | one sweep |

Defaults stay conservative: mirror mode is **off** until the env var is set,
and without it everything behaves exactly as before (imported-only
price/stock/condition; content imported once). Two photo changes apply
regardless of the flag: fresh imports mirror up to eBay's full 24-photo
allowance by default (`EBAY_IMPORT_MAX_IMAGES`), and existing products in
mirror mode are backfilled to the listing's full photo set by the deep pass.

Caveats: in mirror mode, edits made through the admin ProductForm for the
synced fields are overwritten at the next sweep — the CLI to express a
site-only price in mirror mode is an eBay-side change (or turn the flag off).
The rotating deep pass is bounded by design so one sweep never bills 1,000+
GetItem calls at once.

## Tests and sandbox payload validation

Two layers keep the write payloads honest:

1. **Offline contract tests** — `backend/src/services/ebayPayloads.test.ts`
   asserts the exact inventory-item, offer and quantity bodies (including the
   exact decimal price string, marketplace id, policy fields and the Trading
   API `ReviseInventoryStatus` XML) against eBay's documented requirements.
2. **Pipeline integration tests** —
   `backend/src/services/ebaySyncPipeline.integration.test.ts` drives the real
   quantity pipeline (`ebaySyncPipeline.ts`) with a mocked Prisma client and a
   mocked Trading/Inventory API: offer-id precedence over item id, paused rows
   never pushed, archived rows skipped, variation listings settled, retryable
   vs permanent failure statuses, no rollback of central stock, and drift
   reconciliation.

```bash
cd backend
npx tsx --test src/services/ebayPayloads.test.ts src/services/ebaySyncPipeline.integration.test.ts
```

3. **Real sandbox validation** — with sandbox credentials configured, the
   validator creates a throwaway inventory item and FIXED_PRICE offer using
   the real builders, reads both back and asserts what eBay stored (quantity,
   price, category, marketplace, business policies), updates the offer
   quantity and reads it back, and confirms eBay parses the generated Trading
   API request. It refuses to run against production and cleans up after
   itself.

```bash
cd backend
npm run ebay:validate                # live sandbox round-trip + cleanup
npx tsx src/scripts/validateEbaySandboxPayloads.ts --dry-run   # offline only
npx tsx src/scripts/validateEbaySandboxPayloads.ts --publish   # also publish
npx tsx src/scripts/validateEbaySandboxPayloads.ts --json      # CI-friendly
```

When credentials or the merchant location/business policies are missing, the
script still runs the offline checks and reports the live round-trip as
SKIPPED (exit 0) instead of failing.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `EBAY_AUTOSYNC_INTERVAL_MS` | `300000` (5 min) | Sweep interval; floor 5 min to keep full active-list walks within the daily Trading API call budget. |
| `EBAY_AUTO_PUBLISH` | `1` | `0` disables auto-publishing; new imports remain drafts for an admin. |
| `EBAY_CATEGORY_ID_MAP` | *(none)* | JSON map of eBay leaf category id → site slug (see docs above). |
| `EBAY_IMPORT_MAX_IMAGES` | `24` | Photos mirrored per listing; clamped to eBay's 24-photo allowance. |
| `EBAY_FULL_MIRROR` | `0` | `1` makes price, stock, condition, photos, title, description, specifics and end-state follow eBay for **every** walked row (see section above). |
| `EBAY_MIRROR_GETITEM_BUDGET` | `4` | Rows deep-verified per sweep in the rotating window. The effective value is capped to reserve at most 1,200 Trading API calls/day for this pass; other eBay work shares the remaining quota. |
| `EBAY_IMPORT_BATCH_SIZE` | `4` | Catalog import: items attempted per 5-second tick (1–25). |
| `EBAY_IMAGE_BACKFILL_BATCH` | `4` | One-shot image backfill: listings processed per tick (1–12). 4/10s ≈ a 1,000-listing catalog in ~45 min. |
| `EBAY_IMAGE_BACKFILL_TICK_MS` | `10000` | One-shot image backfill: tick cadence in ms (5 s–120 s). |

Credentials and listing-creation config (all required for writes to eBay):

| Variable | Meaning |
| --- | --- |
| `EBAY_ENV` | `sandbox` or `production`. Chooses the API host. |
| `EBAY_SITE_ID` | Marketplace site id; `0` = EBAY_US. |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | App credentials (OAuth client-credentials + refresh-token grant). |
| `EBAY_REFRESH_TOKEN` | User token used by the Sell APIs (Inventory + Fulfillment). |
| `EBAY_MERCHANT_LOCATION_KEY` | Inventory location used when creating offers. |
| `EBAY_FULFILLMENT_POLICY_ID` / `EBAY_PAYMENT_POLICY_ID` / `EBAY_RETURN_POLICY_ID` | Account business policies; listing creation returns 503 until all three are set. |
| `EBAY_PUBLIC_ENDPOINT` / `EBAY_VERIFICATION_TOKEN` | Webhook endpoint validation (challenge hash is `sha256(code + token + endpoint)`). |

The one-shot image backfill (Admin → eBay Hub → Inventory sync → "Backfill
photos") repairs the photo sets of products imported before
`EBAY_IMPORT_MAX_IMAGES` was raised: it walks every mapped, non-ended listing,
GetItems each one and re-mirrors the COMPLETE photo set. It is photo-scope only
(safe without `EBAY_FULL_MIRROR`), idempotent, and can be cancelled mid-run.

Import criteria are deliberately simple so nothing valid is excluded: every
active listing on the account, filtered only by marketplace
(`EBAY_SITE_ID=0` ⇒ EBAY_US). There is no "only imported-SKUs" shortcut in
discovery — the importer dedupes instead.
