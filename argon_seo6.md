# Pending-Task Execution Report — argon_seo5 follow-up

**Executed:** Thu 29 Oct 2026 · closes the "anything pending?" list from `argon_seo5.md` where remote-side action was possible
**Result:** ✅ 5 of 6 pending categories done · tests re-verified: `npm test` 65/65 · `npm run typecheck` clean · dirty-file constraint list respected (`server.js`, `shared/static-pages*`, `scripts/*` untouched)

---

## 1. Stale root `.env.production` — FIXED (with safety gates)

- Sync script sanity-gated every step: the replacement `DATABASE_URL` was proven to authenticate **before** touching the file, a backup was written (`.env.production.bak-before-sync`), then `DATABASE_URL` + `DIRECT_URL` were synced from `backend/.env.production`, and the patched file re-authenticated ✔ post-write.
- No secret printed anywhere — only key names and outcome flags.
- `backend/.env.testrun` intentionally left stale (it is a test-run snapshot; say the word if you want it treated the same way).

## 2. L-5 Maintenance mode — noindex signal ADDED

- `src/pages/Maintenance.tsx` now emits `<SEO noindex title="We'll be right back — Alka Traders" … />` (`SEO.tsx:286` renders `<meta name="robots" content="noindex, follow">`), with a comment documenting why (client-side-only curtain, prerendered HTML stays indexable).
- **Scope note (decision left open on purpose):** server-side enforcement / true 503 during maintenance is still not implemented — that is a hosting-architecture decision (Node mode could query store settings with caching), not a one-liner.

## 3. Flaky test port band — FIXED

- `tests/legacy-html.test.mjs` now spawns `server.js` on **28000–32000**, disjoint from `host-canonicalization.test.mjs` (42000–62000 + dev 60000–64000), with a comment recording the EADDRINUSE flake mechanism (`stdio:'ignore'` swallows the startup FATAL line).
- Evidence: two consecutive clean runs after the fix — 65/65 pass both times (no more "server.js exited early with code 1").

## 4. `.env.example` guidance — ADDED (H-2 operational notes)

- `backend/.env.example` header now states: `JWT_SECRET` and `CSRF_SECRET` protect different mechanisms and must be **distinct** random strings (the unset-fallback must not be relied on in production), and any secret once stored in a local `.env` copy is treated as exposed → rotate in the Railway dashboard and refresh the local copy.

## 5. `/brands` payload measurement — DONE (honest numbers)

Method: sampled **12 of 468** unique brand images (deterministic spread), each fetched at three transform widths (36/36 probes succeeded); `f_auto,q_auto` applied consistently.

| Metric | w_800 (OLD) | w_224 (NEW, retina 2×) | w_112 (NEW, 1×) |
|---|---|---|---|
| Average per image | 4.7 KB | 2.9 KB | 1.4 KB |

**Projected totals (no caching):** OLD ≈ **2.15 MB** (470 × w_800) → NEW ≈ **0.65 MB** (DPR1, −**69.8%**) / **1.33 MB** (DPR2, −**38.0%**). Plus: two non-brand images gone from the marquee and index semantics, DOM `<img>` count 940 → 936.
Caveats recorded: sampled 12/468; repeat visits ≈ 0 (browser cache); the brand logos are small originals, so the audit's "massive" framing holds proportionally, less so absolutely. Also learned: the prerendered `/brands` HTML shell contains **no marquee `<img>`** (marquee hydrates client-side), so live page weight comes from hydration-time fetches — the measurement is emission-based, not from the stale shell.

## 6. Still pending (deliberately — external)

| Item | Why |
|---|---|
| Rotate `ADMIN_PASSWORD`, distinct `JWT_SECRET`/`CSRF_SECRET`, PayPal/Cloudinary/Neon values in **Railway/Neon dashboards** | Provider-side only; local repo cannot execute |
| Server-side maintenance enforcement + real 503 | Architecture decision (which Hostinger mode; Node vs Apache) |
| Brands slug-linking + CSS-only marquee loop | Needs DB brand↔image mapping; duplication is your explicit approved constraint |
| H-1 full `.htaccess` rewrite | Only meaningful in Apache static mode — depends on hosted-mode answer |
| GSC coverage / CrUX-Lighthouse live runs | External tooling access |

---

## Batch diff (this round)

`M backend/.env.example` · `M src/pages/Maintenance.tsx` · `M tests/legacy-html.test.mjs` · root `.env.production` synced (untracked local file) + `.env.production.bak-before-sync` backup.
