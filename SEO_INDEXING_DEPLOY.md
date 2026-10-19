# SEO indexing rollout

This change updates the product URL scheme, product metadata, runtime sitemap, and frontend response handling. The canonical URL policy uses trailing slashes because the production host currently redirects directory-style URLs to that form. Deploy the database migration before deploying the backend code that reads the new fields/tables. The production site is already crawlable, so Google may fetch the old sitemap before rollout; prioritize replacing the old behavior promptly.

## Six rollout gates

The live site is public and `robots.txt` already advertises the sitemap, so Google can crawl it before this rollout. Treat readiness as something to reach quickly. The current live site still serves the old 39-URL sitemap and old SPA fallback behavior; prioritize deploying the fixed code.

### Gate 1 — prove the new runtime is live

Using Googlebot user agent and raw HTTP responses, verify `/` is a 301 to `/en/`, an unknown product URL is a true 404 with `Cache-Control: no-store`, `/ar/` and `/es/` carry noindex in HTML and `X-Robots-Tag`, and `/sitemap.xml` is the new XML without `priority`, `changefreq`, or `hreflang`. Stop the remaining SEO launch checks if these fail; those results mean the intended route handlers are not serving production. The workspace removes the old static sitemap and handles `/sitemap.xml` dynamically.

### Gate 2 — inspect all 12 static pages as raw HTML

For each intended English static URL, use `curl`/View Source (not DevTools' hydrated DOM) and check: a unique title, unique meta description, exactly one self-referencing canonical, one H1, substantive page-specific body copy, and crawlable internal links. Navigation/footer links should be `<a href="…">` anchors. The current prerender template inserts only an H1 and paragraph into each shell, while the React application supplies the fuller content after hydration; that is a known launch gap to resolve or explicitly accept before calling this gate passed. Confirm the home page has Organization and WebSite JSON-LD with accurate public company name, logo, address (only if public), and contact details. Check the Arabic and Spanish raw HTML too: noindex, no hreflang, and accurate page/head details. Do not claim this gate passed from the local SEO audit alone; inspect each generated response.

### Gate 3 — consolidate host and slash variants

Check HTTP and HTTPS, `www` and apex, plus trailing-slash and non-slash variants for representative pages. Each variant should reach one final canonical URL with one 301 and no redirect chain. HTTP apex currently returns a 301 to HTTPS apex. `www.alkatraders.co` did not resolve from the audit workstation, so its behavior is still unknown; confirm DNS and test before declaring this gate passed. If `www` serves a 200 site copy, configure a redirect to the apex host.

### Gate 4 — content and page-quality basics

Run PageSpeed Insights mobile checks for the home page and a catalog page when one exists. Look for severe LCP or layout-shift failures, confirm images have useful alt text, check a real 404 response/page, and read the privacy, terms, and refund pages for substantive and accurate content. A perfect PageSpeed score is not a launch requirement.

### Gate 5 — catalog data (pending real products)

There are currently **no listed products**, as confirmed by the owner; the live storefront API's zero count is expected. Do not create a placeholder solely for SEO validation. When a genuine product is first listed, publish it through the production admin and verify the publish gate, post-publish verifier, storefront API count, product-specific raw HTML and Product JSON-LD, and sitemap entry with sensible `lastmod`. Validate its structured data with Google's Rich Results Test. Then keep it live only if it is genuinely for sale; otherwise unpublish it. Confirm product entry is happening in the production Railway-backed admin/API, never local Neon. Once the first real product pipeline is verified, add catalog inventory in batches of roughly 30–50 quality listings; no need to wait for the whole catalog before sitemap submission.

### Gate 6 — Search Console

Verify the Search Console Domain property by DNS now; this does not depend on code deployment. After Gates 1–4 pass and the sitemap is the new valid XML, submit it even if the catalog is still empty (the eligible static pages can be crawled). Run URL Inspection on the home page and a catalog page; inspect a product once a genuine product exists. Request indexing for only those few important URLs, not in bulk.

## Rollout order

1. Confirm the production project/environment, `api` service and `Postgres` resource, and domain-to-service mapping. This has been checked: both domains terminate at Railway; API database host is `postgres.railway.internal`. Do not use local Neon for this rollout.
2. Take and verify a restorable backup of Railway Postgres before migration. Railway documents volume backups (manual or scheduled) and logical `pg_dump` backups; verify that a snapshot or backup exists and that it can be restored in this project's Backups tab. If you also need a portable dump, use Railway CLI's `railway connect postgres --tunnel-only` where possible, or a temporary TCP proxy, then confirm the dump is readable and close the tunnel/disable the proxy. Do not expose the database publicly as a permanent endpoint. The current dashboard state/plan entitlements have not been inspected, so backup availability for this exact project is not yet confirmed.
3. The Railway IaC now configures `preDeploy: "npx prisma migrate deploy"` for the API service. Railway runs pre-deploy commands between build and start, with service variables and private networking, and a failing command prevents deployment. Apply the updated IaC and verify the API deployment's pre-deploy setting. Alternatively, open a shell in the API service and run the migration once before deploying the new backend. Do not use workstation `railway run` for the migration and do not run `migrate dev`. The new migration is additive (`content_updated_at` plus product slug history), but a backup is still required.
4. Deploy the API service after the migration. Its new code reads the additive fields and serves the dynamic sitemap at `/api/v1/sitemap.xml`.
5. Deploy Railway frontend service `marine` after the API. Railway status and live response headers confirm this service answers for `alkatraders.co`; Hostinger `.htaccess` is not in the request path. Workspace IaC pins `npm run build` and `npm start` (`node server.js`); after applying it, verify the resulting deployment metadata/start logs show those commands and the server listening line. The root build creates `frontend/dist`, prerenders HTML, and copies it to `frontend-dist`; confirm the runtime image contains `frontend/dist/index.html` (health response reports `build:present`).
6. Run Gates 1–4 above against production. The product-specific portions of Gate 5 are explicitly pending until real products are listed.
7. Submit the new sitemap after the technical gates pass; its static English pages remain useful while the catalog is empty. Then complete Gate 5 when genuine inventory is entered and use Search Console for a few representative URLs.

## Environment and operational notes

- Set the `marine` service's public `VITE_API_URL=https://api.alkatraders.co` as a variable available during the **build** as well as runtime. The build-time helper `scripts/fetch-products.mjs` reads `SEO_API_BASE` (defaulting to `https://api.alkatraders.co`) while prerendering. Railway's private network is unavailable during builds, so never set the build-time API origin to `postgres.railway.internal`, an internal Railway hostname, or an unset value that points at the storefront. An unreachable API currently logs a warning and silently continues with zero product prerenders; this is safe while the catalog is intentionally empty but would hide catalog pages if products are added later. `server.js` fetches product data at request time using the API origin; therefore a product entered after build can render without rebuilding, provided the live API has that product and the frontend's public API origin is correct.
- `server.js` uses `VITE_API_URL` or defaults to `https://api.alkatraders.co`; it strips an optional `/api/v1` suffix and requests the backend directly. Do not use the public storefront origin: its `/api/v1/*` path is served as frontend HTML.
- Database fields are additive: `products.content_updated_at` and `product_slug_history`. The migration does not change current product status values or IDs.
- Product HTML and the dynamic sitemap currently index English only. Arabic and Spanish routes remain available through the SPA but are marked noindex in both HTML and `X-Robots-Tag` until translated content and reciprocal alternates are implemented. No hreflang is emitted while equivalent translations are unavailable.
- Product HTML has a five-minute shared-cache policy. If the host/CDN ignores the response cache directive or applies a longer override, purge the product URL on publication and material edits.
- The legacy source sitemap was removed. The Express route handles `/sitemap.xml` before static assets and proxies the API sitemap. Railway production status confirms `alkatraders.co` is attached to the `marine` service; Hostinger config is not in the live traffic path.
- The production storefront products API returned zero published products during the audit, and the production sitemap contained no product URLs. The owner confirms that no products have been listed yet, so zero is expected. The current target is the eligible static English routes only; product URLs and product verifier checks remain pending until authentic product data is entered.
- A read-only count on local Neon returned 1 draft and 3 archived products, with 0 published. The live production API also returned 0. Production Railway variables independently confirmed Railway Postgres as the API database; the Neon status result is not production inventory.
- Railway CLI production metadata settles the DB provider as Railway Postgres (`postgres.railway.internal`). A direct workstation Prisma connection failed because Railway's internal host is not reachable from this machine. The live API reports zero published products; obtain full per-status production counts from within Railway's network if required.
- Live bogus product and hub URLs currently return 200 SPA fallback HTML. The workspace fixes these route handlers, but production still needs the updated `marine` frontend deployment. Workspace product/hub 404s now send `Cache-Control: no-store`; verify that header after rollout.
- Host identity is confirmed: `alkatraders.co` resolves to `69.46.46.16`, `api.alkatraders.co` resolves to `69.46.46.71`, and both are Railway services (`marine`, `api`). Public frontend responses identify Railway Express (`railway-hikari`) and `/health/live` succeeds.
- Active `marine` deployment `f0549f4e-61c5-4771-9b0d-c983771dd01a` runs commit `3a608215706cab475625ecde87607d106903f9f4` (the current Git `HEAD`); the workspace SEO changes are uncommitted and not part of that deployed build. Railway metadata currently leaves build/start commands null. The IaC now explicitly sets `npm run build` and `npm start` for the frontend.
- Final local checks passed: `npm run typecheck`, `npm run build:backend`, `node --check server.js`, `git diff --check`, and a fresh public API query (`total: 0`).
- `Disallow: /admin` prevents crawlers from fetching the admin path; the app also sends noindex there, but a crawler blocked by robots cannot observe that response header. Admin pages should remain authentication-protected regardless.
- No sitemap file is bundled in `public/` or `frontend/dist`. `/sitemap.xml` is a runtime Express route that proxies the XML response from the direct API origin before static asset handling.

## Rollback

The database migration is additive. To roll back application behavior, redeploy the prior frontend and API builds. Keep the added database column/table until the previous code is stable; they are not destructive and can be removed later in a separate reviewed migration.
