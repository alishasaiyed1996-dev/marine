# Status Reconciliation — argon_seo.md audit vs executed work

**Date:** Thu 29 Oct 2026 · answers "anything pending?" against the original audit
**Master reference:** execution details in `argon_seo4.md`, live-DB check in `argon_seo3.md`
**➡ UPDATE:** most actionable pendings closed in `argon_seo6.md` (root env sync, Maintenance noindex, port-band fix, `.env.example` guidance, `/brands` measurement). Remaining external: dashboard rotations, server-side maintenance decision, hosted-mode answer, GSC/CrUX runs.


---

## ✅ Resolved (executed, tests + typecheck green)

| Audit item | Resolution |
|---|---|
| **M-2** mapCondition default → `UsedCondition` | Explicit 5-case mapping, unknown/blank → `undefined`; Offer conditionally spreads `itemCondition`; `.d.ts` widened; new test asserts all cases incl. `"OEM"`/`"Overhauled"` |
| **L-1** ItemList hardcoded `en` URLs | `https://alkatraders.co/${language}/product/…` (`Products.tsx`) |
| **L-2** `about: highIntentSearches` raw strings | Mapped to `{ '@type': 'Thing', name: term }` (`Home.tsx`) |
| **L-3** stale root `dist/` | Deleted (Vite `outDir` is `frontend/dist`) |
| **L-4** orphan `Shop.tsx` | Deleted (zero imports; `server.js` already redirects `/shop`) |
| **M-1** core | Pruned `imgi_236_footer-logo.png` + `imgi_237_payments.png` (470→468); `transformWidth={112}` + `sizes="112px"` (112px + 2× candidate, no more 800px fetches); `imgi_` prefix stripped from alt; duplicated row-half `aria-hidden` + `alt=""` |
| **H-1** (approved scope) | `ErrorDocument 404 /404.html` + static/Node comment added (target `public/404.html` exists) |

## 📊 Resolved by the live-DB check (audit listed under "cannot verify")

- **Real product `condition` values** — verified against live Neon (`ep-orange-voice-aur4fzzm`): 4 rows, only `new` ×3 + `refurbished` ×1, zero blanks → the M-2 "hit rate" question is closed and the mapping frozen is correct for production state.

## 🟡 Partial / deliberately-not-taken extensions (need a decision, or optional)

| Item | State |
|---|---|
| **M-1 row duplication** | Audit proposed *no DOM duplication*; approval said *keep duplication but `aria-hidden`/`alt=""`* (seamless animation). Kept per approval — the DOM still carries 2× nodes. If page-weight still matters, a CSS-only loop can drop the duplication later. |
| **M-1 optional slug links** | Tying marquee tiles to DB brand slugs — not done (optional in audit). |
| **M-1 count claim** | `468+` now (both non-brand files gone). Note: it still counts images, not DB brands; only cosmetic. |
| **H-1 full rewrite** | "Lightweight Phase 3" scope — the explicit-SPA-route-list rewrite was intentionally skipped pending which Hostinger mode is actually live (Node mode makes `.htaccess` inert). |
| **Test port-band race** | New discovery during batch verification (`argon_seo4.md`): `legacy-html.test.mjs` (46000–64000) can `EADDRINUSE` against `host-canonicalization.test.mjs` (42000–62000 / 60000–64000) when files run in parallel. Optional hardening: disjoint bands or bounded retry. |

## ⏳ Pending — new evidence from this session: L-5 maintenance mode (now verified, needs a decision)

The audit flagged L-5 as "verify at runtime". Verification done (read-only):

- **Client-side only**: gating is `settings.maintenanceMode && !adminUser` → `<Maintenance/>` (`src/App.tsx:122–125`); toggle lives in admin settings (`src/pages/admin/settings/SiteConfigTab.tsx:102–110`); default `false` (`useStoreSettings.ts:97`).
- **`server.js` has zero maintenance logic** (grep: no matches) — prerendered indexable HTML keeps being served in every mode.
- **`Maintenance.tsx` emits no `SEO`/noindex meta** (no import, no robots tag) — if the SPA ever renders it as the document, it lacks a noindex signal.
- **No 503 status anywhere** — everything answers 200 while maintenance is "on".

**Consequence:** maintenance mode is a cosmetic curtain for signed-out visitors; crawlers keep seeing the full indexable storefront (prerendered HTML unaffected). If the mode is ever meant to actually hide the catalog, minimum code steps (NOT executed — outside approved batch): add `SEO noindex` to `Maintenance.tsx`, and decide on server-side/503 enforcement (Node mode could query store settings with a short cache).

## ⏳ Pending — external ops (H-2 / Phase 4) — no code can do these

1. Rotate `ADMIN_PASSWORD` (`admin123`) on Railway/Hostinger.
2. Set distinct random `JWT_SECRET` ≠ `CSRF_SECRET`.
3. Treat machine copies of PayPal/Cloudinary/Neon secrets as exposed → rotate in provider dashboards, move values to provider env only.
4. Move live credentials out of the synced `Downloads\` folder (backup/OneDrive risk).
5. **NEW:** root `.env.production` and `backend/.env.testrun` hold STALE `DATABASE_URL` passwords (rejected by live Neon; found during the `argon_seo3.md` check) — update the root file with the current connection string (behind `backend/.env.production`).
6. Update `.env.example` guidance (small code-adjacent task from Phase 4 — the only Phase 4 item still in the repo).

## ⏳ Pending — verification/measurement (audit's "cannot verify" list, still open)

- Which Hostinger app mode is primary (decides how much of H-1 matters, and L-5's server-side options).
- Measured `/brands` payload + Lighthouse/CrUX numbers (post-M-1 page weight gain is unmeasured — structure suggests DB request reduction 940→468 primary + transformed 112px variants).
- Google-side: Search Console coverage, chosen-canonical drift.

---

**Bottom line:** every code item in the approved batch is done and green. Remaining work is (a) ops/security rotations H-2 + stale root env file, (b) decisions on the deliberate partials above, (c) live measurement runs.
