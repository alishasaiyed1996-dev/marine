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

Routes on `/api` (admin auth, inventory-manager role for the run):

| Route | Purpose |
| --- | --- |
| `POST /admin/ebay/catalog-autosync/run` | Force a sweep outside the 5-min schedule. |
| `GET  /admin/ebay/catalog-autosync/status` | Last sweep summary, last import job, `autoPublishEnabled`, per-status mirror counts. |
| `POST /admin/ebay/catalog-import` | Manual full import of all discovered active items. |
| `GET  /admin/ebay/catalog-import` / `/:id` | Inspect import jobs (same data the autosync path creates). |

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

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `EBAY_AUTOSYNC_INTERVAL_MS` | `300000` (5 min) | Sweep interval; floor 60 s. |
| `EBAY_AUTO_PUBLISH` | `1` | `0` disables auto-publishing; new imports remain drafts for an admin. |
| `EBAY_CATEGORY_ID_MAP` | *(none)* | JSON map of eBay leaf category id → site slug (see docs above). |

Import criteria are deliberately simple so nothing valid is excluded: every
active listing on the account, filtered only by marketplace
(`EBAY_SITE_ID=0` ⇒ EBAY_US). There is no "only imported-SKUs" shortcut in
discovery — the importer dedupes instead.
