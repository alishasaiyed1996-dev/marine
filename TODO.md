# TODO

## Storefront / catalog

- [x] **Product images missing on some catalog cards** — reported on `/en/products/`.
  - 2026-10-21 audit: **1,074/1,074** published products have image rows; **1,074/1,074** main Cloudinary URLs returned HTTP 200 `image/*`.
  - Live browser check: the catalog renders 24 cards with Cloudinary images once the catalog request completes; no broken-image tiles were found.
  - Hardening: above-the-fold cards now eager-load with `fetchPriority="high"`; the rest stay lazy-loaded.
  - If a browser still shows blank tiles after a deploy, hard-refresh once (`Ctrl+F5`) to clear an old PWA shell; the service worker updates the cache on activation.

- [x] **Product-detail H1 used generated metadata instead of the product name** — e.g. "GAZ Not Marked Hand Tools".
  - Fixed: the H1 now uses the catalog product name; brand/model/category are only a fallback for nameless records.
  - Page titles, meta descriptions, and JSON-LD identity are unchanged.

- [ ] **Optional follow-up:** add the image-health audit (all published products' main image URLs return `image/*`) to CI so future imports cannot silently ship broken media.
