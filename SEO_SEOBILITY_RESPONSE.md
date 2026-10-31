# Seobility report response — 2026-10-28 crawl

Source report: Seobility crawl of 2026-10-28 12:17, **HTML mode (no JS rendering)**,
crawl limit 100 subpages of ~1,116 prerendered pages, 408 "problems". This file maps
each reported finding to what it actually is (bug / artifact / owner action), what was
changed in the workspace, and how to re-verify.

Reported before any of these changes were deployed — production still served the
previous build when the crawl ran.

## Findings → action mapping

| Seobility finding | Verdict | Action taken |
|---|---|---|
| "Important content only loaded when JS active" | True of the crawlable shells | Static EN shells enriched (below); note Googlebot renders JS, but non-JS bots (incl. AI crawlers) read the shell only, so this was worth fixing at the source |
| 8 pages: problematic meta descriptions | Real bug — mid-word truncation | Fixed (below) |
| 30 pages: title tag needs improvement | Partly real — 5 titles were 66–70 chars | Rewritten to ≤60; the rest were already ≤65/unique (0 duplicate titles in audit) |
| 20 pages: H1 issues | Mostly the homepage shell literally rendering `<h1>Home</h1>` | Fixed; shells use keyword H1s from the shared manifest |
| 12 pages: title keywords not in page text | Consequence of 2-paragraph shells | New shell copy weaves the title's key phrases into the body |
| 66 pages < 500 words | Consequence of 2-paragraph shells + crawl-limit mix | EN static pages rewritten; product shells from real data already ~383–590 words; AR/ES left for follow-up |
| 91 shared text blocks / 60 pages duplicate text | Shell boilerplate ("Browse Alka Traders" + nav + footer identical on every page) | Link block per-page via `links`/`linksHeading`; relative boilerplate share drops with longer unique bodies |
| WWW-redirect issue | **DNS, not code** — `www.alkatraders.co` has no DNS record at all (200/000 both seen from crawl data); `server.js` already 301s `www.` → apex when reachable | Skipped on request; add a `www` CNAME/ALIAS to the Railway `marine` service in the DNS provider to close it (manual task) |
| 101 URLs found only in sitemap + "crawl limit reached" | Crawl-limit artifact (100 of 1,116 pages) | Re-crawl with a higher limit / JS mode |
| 8 pages competing on keywords | Needs the Seobility page list to diagnose | Local audit shows one concrete case: two vacuum-gauge products share an identical title (`…free-ship-1` vs `…free-ship-2`) — differentiate or archive one |
| 5 duplicate content issues | Same + catalog duplication below | See product-level note (below) |
| 1 page with typos | Real: ES industries body "serializers navales" (nonsense in Spanish) | Fixed → "navieras" (`scripts/prerender-locales.mjs`) |
| 0 pages slow / 0 broken / 0 charset issues | Fine | — |
| "uses the latest PHP version" | Tool artifact (site is Node on Railway) | Ignore |

## Code changes (workspace, uncommitted)

1. **Word-boundary truncation everywhere a meta description is cut.**
   A hard `.slice(0, 160)` shipped mid-word descriptions ("… Serving buy") on pages
   whose copy exceeded the SERP budget. Now: `scripts/prerender.mjs` (`truncateWords`),
   `server.js` `cleanText(value, max)`, and `scripts/fetch-products.mjs` cut at the last
   space with the same 55%-fallback policy as `trimToWords` in `shared/product-page.mjs`.
2. **`shared/static-pages.mjs` — rewritten over-length EN metadata + home H1.**
   - home description 212 → 159 chars, products 174 → 137, industries 167 → 151.
   - home `h1: "Home"` → `"Marine Spare Parts & Ship Spares Supplier"` (hydrated page keeps its
     hero H1 "Trusted Marine Spare Parts. Delivered Worldwide.").
3. **`shared/static-pages-i18n.mjs` — 14 over-length AR/ES descriptions trimmed** to ≤160
   complete sentences; **`ar network` + `es network` no longer claim "18 countries"**
   (site-wide constant is `COUNTRIES_SERVED = '50+'`; EN was fixed earlier — translations lagged).
4. **Five titles shortened:** EN industries (70→59), EN rfq (66→58), AR brands (66→50),
   ES home (66→53), ES about (66→64).
5. **`scripts/prerender-routes.mjs` — EN static bodies rewritten.** Two generic paragraphs
   became four to five page-specific paragraphs each, built only from facts already on the
   site (1990, Bhavnagar/Alang, category spread, brand list from `src/data/brands.ts`,
   industries from `src/data/industries.ts`, USD pricing, PayPal, 24/7 emergency desk).
6. **`scripts/prerender.mjs` — `generateBodyHtml` supports `links` + `linksHeading`** so the
   crawlable cross-link block is per page instead of four identical lines on every page, with
   the previous block as the fallback default. Route configs may only link to static routes
   (the audit fails links into DB-driven directories).
7. **`scripts/prerender-locales.mjs` — "serializers navales" → "navieras"** (typo fix).

## Measured result after rebuild (`npm run seo:prerender` + `copy-frontend`)

| Page | words before | words after | H1 (crawler view) |
|---|---|---|---|
| `/en/` | 177 | 360 | Marine Spare Parts & Ship Spares Supplier |
| `/en/products/` | 180 | 338 | Marine Spare Parts & Ship Spares Catalog |
| `/en/industries/` | 164 | 299 | Industries We Serve |
| `/en/brands/` | 165 | 279 | Marine & Industrial Equipment Brands |
| `/en/about/` | 175 | 265 | About Alka Traders |
| `/en/rfq/` | 169 | 268 | Request a Quote |
| `/en/emergency/` | 168 | 269 | Emergency Procurement |
| `/en/contact/` | 164 | 251 | Contact Alka Traders |
| `/en/network/` | 155 | 242 | Global Supplier Network |
| `/en/intelligence/` | 159 | 231 | Market Intelligence |
| `/en/privacy-policy/` | 164 | 220 | Privacy Policy |
| `/en/terms-of-service/` | 170 | 194 | Terms & Conditions |

Product shells from real API data measure 383–590 words in `<article>` (verified sample).
AR/ES shells remain ~185–203 words — extending `prerender-locales.mjs` for the indexable
AR/ES routes is the natural follow-up.

## Verification gates run

- `npm run seo:audit` — **0 errors**. Remaining warnings are catalog-level and predate this work:
  - duplicate title pair: `new-yn100-vacuum-pressure-gauge…-free-ship-1` vs `-2` (differentiate or archive one, then let the slug history 301 the removed one),
  - seller sentence "No cracks or structural damage observed." on 179/1,076 product pages (eBay import boilerplate; dedupe in the product content normalizer or import spelling map).
- `npm test` — 64/64, including the manifest-agreement and title/description-length guards.
- All 39 static pages now: titles ≤65, descriptions ≤160 (39/39 checked).

## To fully clear in the next pass

- Production deploy of the `marine` service (this workspace's changes are not live yet);
  after deploy run `npm run index:audit` (expect the usual 0 errors) and spot-check that
  `https://alkatraders.co/en/` ships the new H1/description.
- `www` DNS record → apex redirect (owner action, skipped here on request).
- Re-run the Seobility crawl in **JS mode with a raised sub-page limit** — that re-reading
  replaces the 100-page sample the 2026-10-28 report is based on, and several counts (thin
  pages, sitemap-only URLs, shared blocks) will only move once the crawl is not truncated.
- If store Settings (`site.seoTitle` / `site.seoDescription`) are ever set in the admin
  panel they override the homepage manifest copy at build and runtime — keep them within
  the ≤65 / ≤160 budgets when entering them.
- AR/ES localized shell bodies stay thin; extend `prerender-locales.mjs` for the routes
  `shared/route-i18n.mjs` marks indexable.
