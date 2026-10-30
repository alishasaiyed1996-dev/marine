# Final Product-Ready Audit — Alka Traders (`marine`)

Full-codebase ship-readiness pass. Scope: every source file (frontend `src/`, backend `backend/src/`, `shared/`, root configs/scripts). Markdown docs, comments-as-docs, tests, and binary assets are out of scope except where a finding references them.

**Rules for this loop**
1. Read the file top to bottom (code lines only, comments noted when they read machine-generated).
2. Log every finding below with file path, line area, what's wrong, why it matters.
3. Fix it, then flip status to `FIXED` with what was done.
4. Dead code / dead files / dead deps get listed and removed.
5. Machine-like comments get rewritten to plain human English.

**Status legend**: `OPEN` → `FIXED` → occasionally `WONTFIX` (with reason).

---

## 0. Baseline

Measured 2026-10-30 before any changes in this pass, so we know what we broke later.

| Check | Command | Result |
| --- | --- | --- |
| Frontend types | `npm run typecheck` | **clean**, 0 errors |
| Lint | `npm run lint` | **clean**, 0 problems |
| Backend types | `cd backend && npx tsc --noEmit` | **clean**, exit 0 |
| Root tests | `npm test` | **64 pass, 0 fail, 1 skipped** |
| Backend tests | `npm --prefix backend test` | **271 pass, 0 fail, 0 skipped** |

The one skipped root test is *"the prerendered product page in dist declares no hreflang alternates"* — it self-skips when `frontend/dist` hasn't been built. Not a defect, but it means hreflang on prerendered product pages is only verified after a full `npm run build`. Re-run the suite post-build before shipping.

**Takeaway**: the codebase compiles and lints clean, so everything below is a *behavioural* or *hygiene* problem that the tooling cannot see — dead paths, wrong logic, stale comments, files nothing imports.

---

## 1. Findings log

### `src/App.tsx` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Broken import: `./pages/admin/AdminEbayInventory`** — file doesn't exist (was renamed to `AdminEbayHub.tsx`). The lazy import resolved to nothing, so any admin hitting `/admin/ebay-inventory` got a chunk-load error. Worse, the sidebar, command palette and active-route logic in `AdminSidebar`/`adminNav` all point to `/admin/ebay` — which had **no route at all**, so the eBay Hub page (2,100+ lines) was unreachable from the UI. | **FIXED** — import repointed to `AdminEbayHub`, route `ebay` added, `ebay-inventory` now redirects to it for old bookmarks. |
| 2 | Route comment `{/* Admin routes — listed FIRST so they take priority */}` fine; no dead code otherwise. | no change |

### `src/main.tsx` — audited, no issues
- Comments are already written for humans (explain *why*, not *what*). Nothing machine-like.
- Theme guard, locale bootstrapping, i18n init all correct. No dead code.

### `vite.config.ts` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Dead service-worker rule**: `runtimeCaching` cached `fonts.googleapis.com` responses ("google-fonts" cache), but every typeface ships self-hosted from `/fonts` and nothing in `index.html`/`src`/`public`/`shared` references Google Fonts at runtime. Rule was pure SW bloat. | **FIXED** — entry removed, replaced with a comment stating why no Google Fonts rule exists (so it doesn't get "restored"). |

### `server.js` — FIXED 2026-10-30
| # | Finding | Status |
| --- | --- | --- |
| 1 | **Dead CSP allowlist entries**: `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` allowed origins no page ever loads (fonts are inlined `@font-face` in index.html). Least-privilege trim. | **FIXED** — origins removed, CSP comment block updated (added note that fonts are self-hosted). |
| 2 | General audit: SSR fetch path (timeout/retry/429 handling), consent-cookie stripping, canonicalization, crawl policy, sitemap merge — all consistent with `shared/*` single sources; no dead code; comments are narrative and human. | no change |

### `index.html` — audited, no issues
- GA4/GTM/Clarity scripts correctly consent-gated with reset-password URL exclusion.
- Fonts preloaded + inlined `@font-face`; theme bootstrap guarded against blocked localStorage.
- Comments are human-written and explain trade-offs. No dead tags.

_Entries get appended below as each file is audited. State `FIXED` only after the fix is written._

---

## 2. Dead code / dead files graveyard

| Path | Why it's dead | Verified by | Status |
| --- | --- | --- | --- |

---

## 3. Comment humanization log

| File | Before (machine tone) | After (human tone) |
| --- | --- | --- |

---

## 4. Ship checklist

- [ ] Typecheck clean (frontend)
- [ ] Typecheck clean (backend)
- [ ] Lint clean
- [ ] Unit tests pass (backend)
- [ ] Root tests pass (mjs)
- [ ] No unused exports/files flagged above
- [ ] Final build compiles
