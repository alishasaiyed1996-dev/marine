# Decision Log — argon_seo follow-up

**Logged:** Thu 29 Oct 2026
**Status:** ✅ EXECUTED — full batch complete, 65/65 tests + typecheck green. Live check: `argon_seo3.md`; diff report: `argon_seo4.md`.

---

## Why we're waiting

The approved M-2 design freezes `mapCondition` to the confirmed 5-value enum:
`new` · `unused` · `used` · `refurbished` · `reconditioned`

Before edits run, the free-form `VARCHAR(30)` column must be verified against legacy/junk rows
(written before the zod enum existed, or typed directly in the Neon console).

## Pending action (you)

Run this in the Neon SQL console and paste the output back:

```sql
SELECT condition, COUNT(*) AS n FROM "Product" GROUP BY 1 ORDER BY 2 DESC;
```

## Branch logic on the result

| Result | Then |
|---|---|
| Only the 5 enum values | Execute **full Phase 1–3 batch** exactly as designed in `argon_seo1.md` (mapping already final; no changes needed) |
| Blank/NULL rows counted | Same full batch proceeds; blank → `itemCondition` omitted by the new mapper — just note the count |
| Junk strings present | Full batch proceeds **plus** scope expansion: clean those rows in the DB (following `argon_seo1.md` verdicts — e.g. "Overhauled" → `reconditioned`, "Like New"/"Open Box" → `unused`) and decide whether `conditionLabel`'s display fallback (shared/product-page.mjs:930) stays "Used" or changes |

## Queued work (NOT started, blocked behind this check)

| ID | Item | State |
|---|---|---|
| M-2 | `mapCondition` unknown → omit `itemCondition`, explicit `used` case; touch `shared/product-page.mjs` (:1540 spread), `product-page.d.ts` (:124, :190–191), add `itemCondition` tests | Design final — argon_seo1.md |
| M-1 | Brands.tsx: prune 2 footer images, `transformWidth` for `w-24` tiles, `aria-hidden`/`alt=""` on marquee duplicats, strip `imgi_` prefix from alt | Not started |
| L-1..L-4 | Delete `src/pages/Shop.tsx` + stale `dist/`, locale-aware URL fix (`Products.tsx:335`), `Thing` wrap (`Home.tsx:112`) | Not started |
| H-1 | `public/.htaccess` — `ErrorDocument 404 /404.html` + comment | Not started |
| — | Run existing test suite after changes; report diff | Not started |

## Constraints maintained throughout

`server.js`, `shared/static-pages.mjs`, `shared/static-pages-i18n.mjs`, `scripts/*.mjs` stay untouched (uncommitted work in tree, per `git status`).

## Standing instruction

Archive every findings round to a new md file (`argon_seo2.md`, `argon_seo3.md`, …) and copy to clipboard when possible (`Set-Clipboard` works in this session).

## Reminders independent of code (not agent tasks)

- If Railway/Hostinger env mirrors the local `.env.production`: rotate `ADMIN_PASSWORD`, set distinct random values for `JWT_SECRET` and `CSRF_SECRET`.
- Consider moving live PayPal/Cloudinary/Neon credentials out of any synced Downloads folder.
