# Deep ranking research — indexing every page and every product

**Site:** https://alkatraders.co/ · **Property:** Search Console domain property (verified)
**Research date:** 2026-10-27
**Method:** live Googlebot-user-agent crawl of all 1,125 sitemap URLs, direct load tests against
the storefront API, a catalog-wide data grade of all 1,074 published products, and Google's own
crawling documentation.
**Evidence:** `reports/index-audit-2026-10-27.json`, `reports/catalog-seo-2026-10-27.json`

---

## Bottom line

The site is **not** waiting on backlinks, content strategy, or a Search Console submission. It is
serving **HTTP 503 pages to Googlebot for roughly 80% of its product catalog**, and Google's
documented response to that is to slow crawling and drop URLs from the index.

Every technical SEO signal the previous audits fixed is **live and correct**: canonicals are
self-referential, unknown URLs return real 404s, and the sitemap matches the API catalogue. Fixing
the 503 path is worth more than any content or link work, because content that is never successfully
crawled cannot rank at all.

**Do this first:** stop the frontend's server-to-server catalog fetches from being rate-limited
(section 1). Everything else in this document is subordinate to that.

---

## 1. The blocker: a 429 becomes a 503, and a 503 de-indexes

### What was measured

A full Googlebot crawl of the sitemap, run twice, at concurrency 8:

| Page type | URLs | Run 1 (503s) | Run 2 (503s) |
|---|---|---|---|
| Product pages | 1,074 | **937** | **855** |
| Category hubs | 12 | **12** | **12** |
| Static pages | 39 | 0 | 0 |

The 503 response is not a search engine's idea of a missing page — it is the site's own outage
shell: `<title>Temporarily unavailable | Alka Traders</title>`, `X-Robots-Tag: noindex, follow`,
`Cache-Control: no-store`. So for ~80% of the catalog, Googlebot is told *"come back later, do not
index this."*

### The cause, traced to the source

1. `server.js` renders each product server-side by calling the API at
   `/api/v1/storefront/products/by-slug/<slug>`. Every request originates from **one IP** — the
   frontend service.
2. `backend/src/server.ts` mounts the storefront product and hub routers behind `publicLimiter`,
   which allows **100 requests per minute per IP in production**:
   ```ts
   const publicLimiter = rateLimit({
     windowMs: 60 * 1000,
     max: process.env.NODE_ENV === 'production' ? 100 : ...,
   })
   app.use(`${prefix}/storefront/products`, publicLimiter, storefrontProductRoutes)
   ```
3. A crawl of 1,074 products trivially exceeds 100 requests/minute, so the API starts answering
   **429 `{"error":"Too many requests, please try again later."}`**.
4. `fetchPublishedProduct` / `fetchProductById` / `fetchHub` treat any non-OK response as an error
   and throw. The route's catch block calls `temporaryShell(res, req)` → **503 + noindex**.

Reproduced directly: 400 **distinct** product URLs at concurrency 8 produced
`{"200": 354, "429": 46}` with p95 latency 924 ms. (An earlier test reusing a single URL showed no
429s, because the API's in-memory GET cache serves repeat URLs and bypasses the limiter — which is
why this hid for so long. A crawler requests *distinct* URLs.)

### Why this matters more than it looks

Google's crawling documentation is explicit:

> "5xx and 429 server errors prompt Google's crawlers to temporarily slow down with crawling. For
> Google Search, already indexed URLs are preserved in the index, but eventually dropped."
> — [How HTTP status codes affect Google's crawlers](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes)

and, on 429 specifically: *"Google's crawlers treat the 429 status code as a signal that the server
is overloaded, and it's considered a server error."*

So the current behaviour does three bad things at once: it throttles Google's crawl of the whole
site, it prevents indexing of the majority of products, and on a repeat crawl it can **remove
products that had already made it into the index**. Google notes it "gradually increases the crawl
rate" once the server returns 2xx again — so a fix is durable, not a one-off reprieve.

### The fix, in order of preference

1. **Exempt the SSR frontend from the visitor rate limit.** The frontend is one trusted, internal
   client that legitimately needs the whole catalog; it should not be governed by a limiter designed
   to stop abuse from public visitors. Add a shared secret (e.g. `SSR_API_TOKEN`) that `server.js`
   sends on its API calls and `publicLimiter` skips via its `skip` option. This removes the failure
   without weakening protection for real clients.
2. **Make the frontend resilient rather than fatal.** `fetchPublishedProduct`, `fetchProductById`
   and `fetchHub` currently have **no `AbortSignal` timeout**, unlike `fetchSiteSeoSettings` (2s).
   Add a timeout sized to the API's real p95 (~1s observed), plus bounded retry with backoff for
   429/5xx, and only then fall back to the 503 shell.
3. **Shape the limit for read-only GETs.** If a token is not acceptable, give the storefront
   `products`/`brands`/`categories` GET routes a much higher ceiling (or key the limiter on the
   upstream client IP rather than the SSR service), so a legitimate crawl is not treated as abuse.
4. **Prime the cache before a crawl is expected.** The product HTML carries
   `s-maxage=300, stale-while-revalidate=1800`, so a warm cache absorbs crawl bursts — but a cold
   cache is exactly when Google arrives. Warming does not replace fixes 1–3.

**Do not** raise the limiter to "effectively infinite" for all clients; that removes a real abuse
control. Fixes 1 and 2 together are the safe, targeted change.

### The 12 category hubs are worse

All 12 category hub pages returned 503 in **both** runs. They call the same limiter-protected API,
and the hub payload is heavier (up to 24 products plus child categories), so they lose that race
first. Because hubs are the site's main internal linking surface, this compounds section 3.

---

## 2. Verified state of the indexable inventory

Sitemap `/sitemap.xml` (dynamic, `x-sitemap-source: api`) — **1,125 URLs**:

| Segment | Count | Notes |
|---|---|---|
| Product pages | 1,074 | matches the storefront API `total` exactly |
| Static pages | 39 | 13 routes × 3 locales (en/ar/es) |
| Category hubs | 12 | |
| Brand hubs | **0** | see section 3 — no brand qualifies |

**Confirmed working (do not re-litigate these):**

- `/` → 301 → `/en/`; unknown product URLs → **404** with `Cache-Control: no-store`.
- Canonicals are self-referential on every URL that returns 200.
- No URL is listed in the sitemap while serving `noindex` — the sitemap and robots signals agree.
- `/ar/` and `/es/` are now genuinely indexable with translated titles, H1s and body copy
  (previously noindex), and the sitemap's hreflang alternates match.
- Indexable product pages carry 340–715 visible words, titles of 46–70 characters, and a complete
  `Product` JSON-LD block alongside `Organization`, `WebSite`, `FAQPage` and `BreadcrumbList`.

**Residual warnings on pages that did return 200** (from the crawl): 11 Product JSON-LD blocks with
no `brand`, 5 meta descriptions under 80 characters, 4 titles over 70 characters, 1 product with
neither `sku` nor `mpn` in its schema.

---

## 3. The brand relation is empty across the entire catalogue

The catalog sweep graded all 1,074 published products. The single most systematic gap:

> **1,074 of 1,074 products (100%) have no `brand` assigned.**

Verified against the API directly: on a 100-product page, `brandId` was null **100/100**, while
`categoryId` was set 100/100 and `manufacturer` was set 100/100. The eBay importer populated the
free-text `manufacturer` field (e.g. `GEDORE`) but never linked the `brand` relation.

Consequences, all of which suppress ranking:

- **No brand hubs exist.** Hub indexability requires published products, so all 22 brands have zero
  qualifying products and **zero brand URLs appear in the sitemap**. An entire intended hub tier is
  missing from the site's information architecture.
- **The internal link graph is starved.** Product pages link to a category hub and related products,
  but not to a brand collection — links are the primary way Google discovers and weights pages.
- **Product JSON-LD `brand` is missing or inferred** rather than authoritative, which weakens the
  entity signal and the Merchant Center feed.
- Brand filtering on the storefront returns nothing useful.

**Fix:** map `manufacturer` → `brand` (a deterministic dictionary of the ~22 existing brands against
the imported manufacturer strings), backfill, then let `isHubIndexable` promote hubs as their copy
qualifies. This is the highest-leverage *non-blocking* fix available: it converts 1,074 existing
products into hub links and unlocks the brand tier of the sitemap.

---

## 4. Content quality: the difference between "indexed" and "ranked"

Google is clear that a 200 does not mean indexed: *"For Google Search, an HTTP 2xx (success) status
code doesn't guarantee indexing."* For large catalogues the binding constraint is usually **content
value**, which is precisely the risk for 1,074 items imported wholesale from eBay listings.

The catalog grade (`npm run catalog:audit`, average 89.6/100):

| Finding | Products | Share |
|---|---|---|
| No `brand` assigned | 1,074 | 100% |
| Description thin for ranking (< 150 words) | 455 | 42% |
| No model / MPN / IMPA identifier | 92 | 9% |
| Description **below the 50-word publish gate** | 61 | 6% |
| Zero stock | 6 | <1% |
| SEO title under 20 characters | 1 | <1% |

Two notes on that table:

- The **61 products below the documented publish gate** are published anyway. Either the gate was
  bypassed (bulk publish, CSV import, or the eBay import path) or the rule changed. Publishing
  sub-gate content contradicts `SEO_INDEXING_AUDIT.md` and is the most likely source of
  "Crawled – currently not indexed" reports for exactly those URLs.
- **Static pages are thin**: 187–213 visible words each, against a 250-word threshold. The homepage
  competes for the most valuable terms on the site with less copy than a single product page.

What actually differentiates a page in this niche is **unique, verifiable specifics** — and the
schema already has the fields: `condition` + `conditionNotes`, `specs`, `keyFeatures`,
`compatibilityNotes`, `includedItems`, `excludedItems`, `warrantyNotes`, `leadTime`,
`publicItemLocation`, and the identity columns. Populating these is what makes 1,074 near-identical
surplus listings into 1,074 distinct answers.

---

## 5. Ranking research for this market

The demand shape for B2B marine spares is unusual and favours the exact strategy the codebase was
built for.

**1. Demand is overwhelmingly long-tail and part-number-driven.** Buyers search for
`GEDORE 2187G`, `TOYO KEIKI DVF-11V`, or `IMPA 750123` — not "marine spare parts". The title builder
(`buildProductTitleQuick`) already composes `brand + model/MPN + product type`, which is the correct
pattern. Its quality is therefore capped by the *identity fields*, which is why the 92 products
without identifiers and the 100% missing brand relation matter more than stylistic title work.

**2. Entity consistency beats keyword repetition.** Google's brand panel and trust signals are built
from consistent NAP, `Organization` schema, and a verified Google Business Profile. `Organization`
JSON-LD is present and correct. The outstanding items are the manual P0 profiles already tracked in
`SEO_BACKLINK_PLAN.md` (Google Business Profile, Bing Places, LinkedIn, Apple Business Connect).

**3. Internal linking is the biggest untapped lever.** With brand hubs missing and category hubs
currently 503ing, the site has effectively **no hub layer**. Once sections 1 and 3 are fixed, every
product gains a link from a brand hub, a category hub, and related-product blocks. On a 1,074-page
site that is the difference between a flat list of URLs and a navigable graph.

**4. Crawl budget is not the constraint — crawl *rate* is.** 1,125 URLs is small; a healthy site of
this size is crawled in days. The only thing throttling Google here is the 5xx/429 pattern
documented above. This is the rare case where fixing one server behaviour converts the whole
catalogue from "crawlable in theory" to "crawlable in practice".

**5. Merchant Center is a parallel surface.** `MT-1` (feed submission) and `MT-9` are untouched and
independent of organic indexing. The feed is live and already carries real `brand`, `mpn`,
`condition`, `price` and `availability` — but its quality depends on the same identity fields
flagged in section 4.

**6. Expect "Crawled – currently not indexed" on commodity items even after the fix.** Google's
documented position is that this reflects an algorithmic value assessment, not a technical error.
Recovery comes from uniqueness (specs, condition, compatibility), consolidation of near-duplicates,
and internal links — not from resubmission.

---

## 6. Action plan, in priority order

| # | Action | Why | Owner |
|---|---|---|---|
| 1 | Exempt SSR API calls from `publicLimiter` via a shared token; add timeouts + bounded retry to `server.js` product/hub fetches | Blocks ~80% of the catalog from being indexed and can de-index pages | Code |
| 2 | Re-run `npm run index:audit` and confirm 503s → 0 | Proves the fix; until then nothing else can be validated | Code |
| 3 | Backfill the `brand` relation from `manufacturer` across all 1,074 products | Unlocks brand hubs, hub links, and schema `brand` | Code + data |
| 4 | Enrich the 61 sub-gate products and the 92 missing-identity products | Removes the likeliest "crawled – not indexed" cohort | Catalogue |
| 5 | Deepen the 455 thin descriptions with specs/condition/compatibility facts | Differentiates commodity listings | Catalogue |
| 6 | Add substantive copy to the 13 static pages (187–213 words now) | They compete for the highest-value non-product terms | Content |
| 7 | Verify Search Console API access (MT-8) and run `npm run gsc:audit` | Gives index status per URL instead of guesswork | Manual + code |
| 8 | Submit `/sitemap.xml`; publish the Google Business Profile and P0 citations | Establishes the entity, per `SEO_BACKLINK_PLAN.md` | Manual |

Sequence matters: actions 1–2 gate everything else, because a catalogue that returns 503 to
Googlebot cannot be measured, ranked, or trusted — no matter how good the metadata is.

---

## 7. The measurement loop

Three scripts now cover this, and they are complementary — none of them alone is enough.

```bash
npm run index:audit     # crawl every sitemap URL as Googlebot; canonical/robots/JSON-LD/503 checks
npm run catalog:audit   # grade every published product's metadata at catalog scale
npm run gsc:audit       # Search Console URL Inspection: index verdict + coverage reason per URL
```

`index:audit` and `catalog:audit` need no credentials and are safe to run on demand; both write JSON
and CSV into `reports/`. `gsc:audit` is the only one that can answer *"is this URL actually in
Google's index, and if not, why?"* — it needs the one-time service-account setup in `MT-8`, and it
supports `--dry-run` (URL enumeration without credentials), `--limit` and `--resume` to stay inside
the API's ~2,000-inspections-per-day quota.

Suggested cadence: `index:audit` after every deploy; `catalog:audit` weekly while catalogue metadata
is being fixed; `gsc:audit` monthly, and after any fix, watching the **"Indexed" share** and the
distribution of coverage states.

---

## 8. What this work cannot do

Fixing the 503 path makes every page **crawlable and indexable**. It does not make it **rank**.
Google's own documentation states that even a 200 response does not guarantee indexing, and ranking
additionally depends on content uniqueness, demand, links, site reputation and competition. For
terms like "marine spare parts", a 1,074-item imported catalogue with thin descriptions will not
outrank established competitors on domain strength alone. The realistic early wins are the long-tail
part-number and brand+model queries, which is exactly what actions 3–5 target, and which the
existing backlink and citation plan in `SEO_BACKLINK_PLAN.md` supports over a 6–12 month horizon.
