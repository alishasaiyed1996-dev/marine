# eBay listing previews (GraphQL Inventory Mapping API)

How the website asks eBay "what would you list this as?" before actually listing,
using eBay's modernized GraphQL gateway (GA Oct 2026). This replaces the old
hand-typed numeric category id with eBay's own recommendation, pre-fills the
item specifics eBay usually demands for the category — the main source of
publish rejections until now — and surfaces the eBay catalog match (ePID).

Source of truth:
`https://developer.ebay.com/develop/api/sell/inventory_mapping` (the
`…inventory_mapping.md` endpoint mirrors the site content).

```
Admin (eBay Hub → Listings)
  │  "Generate suggestions"
  ▼
POST /admin/ebay/listing-previews/run
  │  published products, no live eBay listing
  │  (newest first, ≤ EBAY_PREVIEW_BATCH, ceiling 10 —
  │   eBay's documented maximum for ONE mutation)      ebayListingPreviewsService.ts
  │  site product → ExternalProductDetailsInput
  │  { sku, title≤250, categoryName ("/root/…/leaf" path
  │    or plain leaf name), https-only images ≤24,
  │    Brand/MPN aspects }  — no externalProductIdentifierInput
  ▼
mutation startListingPreviewsCreation          →  eBay async task id + errors?
  │      (StartListingPreviewsCreationInput!)   graphqlapi.ebay.com/graphql
  │                                            + X-EBAY-C-MARKETPLACE-ID: EBAY_US
  ▼
ebay_listing_preview_tasks row (status running)
  │
  │  UI polls GET /admin/ebay/listing-previews/tasks/:id every ~3 s
  ▼
query listingPreviewsCreationTaskById({ id })   →  ListingPreviewsCreationTask
  │  result: null until the async task completes
  │  completionStatus COMPLETED | COMPLETED_WITH_ERROR | FAILED
  │  listingPreviews: mappingReferenceId (25 chars), recommended category
  │    { categoryId, level, name }, ePID (catalog match), suggested title,
  │    suggested description, ePS image URLs,
  │    aspects with name/aspectValues/values{value, confidence PREFILL|HINT}
  │  unprocessedProducts (retriable) / unmappedProducts (do NOT retry)
  │  invalidProducts (+ description, debugging aid only)
  ▼
applyTaskResult() → ebay_listing_previews rows (one per product per task)
```

## What the suggestions are used for

`POST /admin/ebay/listings` (`createListingForProduct`) resolves the eBay
category in this order:

1. **Admin-typed id** in the "List a product on eBay" card — always wins.
2. **Latest eBay preview suggestion** for the product (`ok` outcome) — its
   recommended category id is used, and **PREFILL-confidence aspects** are
   merged into the inventory item (HINT values are never auto-applied;
   Brand/MPN the seller set are never overwritten). The preview row is marked
   `applied`.
3. Neither → clear error telling the admin to run suggestions or type the id.

## Admin surface (eBay Hub → Listings)

| Card | What it does |
| --- | --- |
| **Listing previews (eBay suggestions)** | Start a suggestions run, watch the task, see per-product outcomes, one-click **List with suggestion**, per-product **Retry** for `unprocessed` rows. |
| **List a product on eBay** | Category id is *optional*; empty + a suggestion = eBay's recommendation. |

Outcomes per product (`applyTaskResult`, doc semantics):

* `ok` — a preview was created; row carries category id/level/name, ePID,
  suggested title, aspects, `mapping_reference_id`, raw response.
* `unprocessed` — eBay didn't process it "due to unforeseen circumstances";
  **documented as retriable** → the row shows a per-product **Retry** button
  that re-runs the task with just that product id.
* `unmapped` — was a valid product but eBay "failed to map it… should not be
  retried by the client" → UI shows *do not resubmit unchanged* (fix data or
  type a category id instead of re-sending as-is).
* `invalid` — rejected; `reason` carries eBay's `description`, which is
  explicitly a human debugging aid (not localized, may change) — never a
  client-handling contract.

## Backend map

| File | Role |
| --- | --- |
| `backend/src/services/ebayListingPreviewsPure.ts` | Pure builders/policy (unit-tested): external product build (25-char title cap, https-only images ≤24, breadcrumb `categoryName`, 100-char aspect clamps, ≤10 batch cap), PREFILL/HINT merge, category extraction, status mapping. |
| `backend/src/services/ebayListingPreviewsService.ts` | GraphQL documents + task orchestration (start, one-step poll, flatten into `ebay_listing_previews`). |
| `backend/src/services/ebayClient.ts` | `graphqlFetch()` (adds `X-EBAY-C-MARKETPLACE-ID: EBAY_US`) + `getMappingUserAccessToken()` — separate token cache that requests the extra scope; keeps REST auth untouched. |
| `backend/src/services/ebayListingService.ts` | Consumes suggestions via `getLatestSuggestedPreview()` / `mergeAspectRecommendations()`. |
| `backend/src/routes/admin/ebay.ts` | Routes: `POST /listing-previews/run` (zod ≤10), `GET /listing-previews/tasks`, `GET /listing-previews/tasks/:id`; `POST /listings` accepts a missing `categoryId`. |

## Data model

* `ebay_listing_preview_tasks` — one row per eBay task (`ebay_task_id` unique,
  counts `created|unprocessed|unmapped|invalid`, status
  `running|completed|completed_with_error|failed`). Migration:
  `20261031000001_add_ebay_listing_previews`.
* `ebay_listing_previews` — one row per (task, product); `outcome`, recommended
  `category_id/level/name`, `epid`, `mapping_reference_id` (25-char id eBay asks
  sellers to reference when creating/revising listings from a preview),
  `suggested_title`, `aspects` JSON, raw `response` for debugging; `status`
  `suggested|applied`.

## Notes and edge cases carried over from eBay's docs

* **US marketplace only** — the marketplace is set by the
  `X-EBAY-C-MARKETPLACE-ID: EBAY_US` header (not an input field); eBay Motors
  and Parts & Accessories are excluded. Results are only valid for the US site.
* **Maximum 10 products per startListingPreviewsCreation mutation** —
  `EBAY_PREVIEW_BATCH` (default 10) is clamped to 1–10, and the route zod body
  rejects >10 product ids.
* **Identifiers are GTIN-only** (`UPC | ISBN | EAN`; `MPN` is documented as
  unsupported), and when a GTIN is provided *no other data shall be provided*
  for that product. Since sku/title/images/category/aspects produce better
  previews ("include as many fields as possible"), we send **no identifiers at
  all** — Brand and MPN ride along as aspects.
* `categoryName` accepts the plain leaf name ("Smart Watches") **or** the
  breadcrumb path (`/Electronics/Cell Phones & Accessories/Smart Watches`); we
  send the path when the site category tree has ancestors (3 levels deep max in
  the select), else the leaf name.
* External product **title ≤250 chars**, no HTML/JS; **images must be https**,
  ≤24; aspects ≤50 with name ≤100 and each value ≤100; sku optional but
  "highly recommended" (it is our key for mapping results back to products).
* The task is **asynchronous**; `result` stays `null` until the task completes
  (`listingPreviewsCreationTaskById` may also return a null task right after
  submission) — the poll endpoint keeps the row `running` and the UI polls ~3 s.
* The mutation can return top-level `errors` (`errorDescription` — human
  debugging aid); surfaced in the 502 message when no task id comes back.
* `ListingPreview.category.id` is **deprecated** ("replaced by categoryId");
  `recommendedCategoryId()` prefers `categoryId`, falls back to `id`.
* Some aspects accept **multiple values** — eBay may return several `PREFILL`
  values for one aspect ("Color: Red, Blue, Green"); the merge keeps eBay's
  full value list. Cross-check category aspects with the Taxonomy API when in
  doubt (`confidence: PREFILL | HINT`).
* `mappingReferenceId` (≤25 chars): eBay asks sellers to **include it when
  creating or revising a listing built from the preview** — our REST Sell
  Inventory publish flow has no documented field for it, so we persist the id
  for diagnostics/support conversations (see MANUAL_TASKS MT-24).
* Alternative integration: eBay can push completion events via the
  Notification API topic `LISTING_PREVIEW_CREATION_TASK_STATUS`; we poll
  instead (stateless, restart-safe) and only use the task query.
* Sandbox: supported via `graphqlapi.sandbox.ebay.com` when `EBAY_ENV != production`.

## Scope / auth (MT-24)

`graphqlFetch` authenticates exactly like the REST layer, but the OAuth request
must include `https://api.ebay.com/oauth/api_scope/sell.inventory.mapping`. Since
a refresh grant only returns scopes granted at mint time, `getMappingUserAccessToken()`
mints its **own** cached token; until the refresh token in env is re-minted, eBay
answers `invalid_scope` and the run endpoint returns 503 with a re-mint message —
while every other eBay call (offers, quantity, orders, Trading) keeps working.
(Not in the scope list above: ePID-based catalog prefill after matching may also
need `sell.inventory` / catalog scopes on a first real run — verify at MT-24.)

## Known unknowns (checked on first sandbox run)

The GraphQL documents sit at the top of `ebayListingPreviewsService.ts` as two
constants. Type names (`StartListingPreviewsCreationInput`,
`StartListingPreviewsCreationOutput`, `StartListingPreviewsCreationTaskById…`),
the `externalProducts` list field and the preview/task result fields are taken
verbatim from the documented schema — the earlier `ListingPreviewsCreationInput`
guess is corrected. What a hosted run can still reveal:

* whether `operationName` (we send it), the Bearer-only header set and the
  sandbox host mirror behave exactly as the docs imply;
* real-world `errorDescription` wording for validation failures ("maximum 10
  products" on the gateway side, `categoryName` quality warnings, etc.).

If eBay reports a validation error naming a field on the first run, correct
that one constant — every caller friendly field name is pinned in pure-helper
tests (`ebayListingPreviews.test.ts`).
