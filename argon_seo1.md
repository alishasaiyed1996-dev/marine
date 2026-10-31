# Condition Field Investigation — argon_seo follow-up

**Session:** Thu 29 Oct 2026 · Working dir: `C:\Users\HP\Downloads\marine`
**Question:** What values do products actually use in the DB for the `condition` field, so `mapCondition` catches all valid ones before dropping the rest?

---

## Answer: exactly 5 lowercase enum strings, by construction

`'new'` · `'unused'` · `'used'` · `'refurbished'` · `'reconditioned'`

### Evidence chain (every write path traced)

| Source | Constraint | Location |
|---|---|---|
| Admin API (only product mutation route) | `z.enum(['new','unused','used','refurbished','reconditioned'])` — rejects anything else | `backend/src/routes/admin/products.ts:20` |
| Admin form | Select options: New / "Unused · New Old Stock" / Used / Refurbished / Reconditioned | `src/components/admin/ProductFormBasics.tsx:128–132` |
| eBay ingestion | `mapEbayCondition()` normalizes eBay ConditionID + display names into the 5-value `WebsiteCondition` type; unrecognized → `'used'` | `backend/src/services/ebayCatalogMapping.ts:82, 119–132` |
| Prisma seed | Catalog intentionally empty — no bulk condition strings exist | `backend/prisma/seed.ts:116` |
| Prisma schema | `String @default("used") @db.VarChar(30)` — free-form at DB level; the guard is the zod layer above | `backend/prisma/schema.prisma:85` |

### Mapping of audit's hypothetical marine jargon → reality

| Audit feared | Actual system value |
|---|---|
| "Surplus" | `unused` ("Unused / New Old Stock"); eBay "Like New / Open Box" ingests to `unused` |
| "Overhauled" | `reconditioned` (storefront badge renders it "Tested" — `src/components/ui/ProductCard.tsx:27`) |
| "OEM" | Not a condition — a genuineness attribute; appears in no condition code path |

**Conclusion:** the audit's "blank or marine strings silently become `UsedCondition`" scenario cannot arise from real data flows. The `default:` branch only fires for blank/null/junk values (pre-zod legacy rows or direct Neon console edits).

---

## Verification before freezing the mapping (run in Neon SQL console)

The column is free-form `VARCHAR(30)`, so confirm no legacy junk exists:

```sql
SELECT condition, COUNT(*) AS n FROM "Product" GROUP BY 1 ORDER BY 2 DESC;
```

Expected: only the 5 values. Any other row value goes on the cleanup list (and would also make `conditionLabel`'s display fallback render the word "Used", see below).

---

## M-2 fix design (shared/product-page.mjs)

### Proposed final mapper

```js
function mapCondition(condition) {
  switch (cleanText(condition).toLowerCase()) {
    case 'new':
    case 'unused':
      return 'https://schema.org/NewCondition'
    case 'refurbished':
    case 'reconditioned':
      return 'https://schema.org/RefurbishedCondition'
    case 'used':
      return 'https://schema.org/UsedCondition'
    default:
      return undefined // omit itemCondition — never assert a condition we don't know
  }
}
```

### Required knock-on edits

1. `shared/product-page.mjs:1540` — offer builds `itemCondition: conditionSchema` unconditionally → switch to conditional spread, mirroring the compliant client-side builder:
   `...(conditionSchema ? { itemCondition: conditionSchema } : {})`
2. `shared/product-page.d.ts:124` — `conditionSchema: string` → `string | undefined`
3. `shared/product-page.d.ts:190–191` — `mapCondition` / `mapProductCondition` return `string | undefined`
4. `mapProductCondition` (`shared/product-page.mjs:1781`) delegates to `mapCondition`, inherits behavior; currently unreferenced in `src/`, no extra consumers to audit
5. Client side already correct — `src/components/seo/SEO.tsx:249–251` conditionally spreads `itemCondition` when truthy; no change

### Do NOT touch / intentional defaults

| Mapper | Why the default is correct |
|---|---|
| `backend/src/services/merchantFeedService.ts:159` | Merchant Center `g:condition` must be one of new/refurbished/used — omission invalid, fallback `'used'` required |
| `backend/src/services/ebayListingService.ts:45–53` | eBay offers require a condition; fallback `USED_EXCELLENT`. Code comment states intent: "anything unrecognized defaults to 'used' — never oversell a used part as new" |
| `conditionLabel` (`shared/product-page.mjs:928–930`) | Display text, not structured data. Fallback renders "Used" for unknown strings — optional future cleanup, not part of M-2 |

### Test gap found

`tests/structured-data.test.mjs` has **zero assertions on `itemCondition`** today. Add:
- `'used'` → `offers.itemCondition === 'https://schema.org/UsedCondition'`
- `'new'` / `'unused'` → `NewCondition`; `'refurbished'` / `'reconditioned'` → `RefurbishedCondition`
- blank / null / unknown string → `offers.itemCondition === undefined` (key omitted)

---

## Constraint reminder (from approved execution prompt)

Do NOT touch uncommitted files: `server.js`, `shared/static-pages.mjs`, `shared/static-pages-i18n.mjs`, `scripts/*.mjs` (dirty per `git status`). M-2 touches only `shared/product-page.mjs`, `shared/product-page.d.ts`, and tests — outside that list.

## Status

🟡 **HOLD** — user opted to wait for the Neon `GROUP BY` result before any edits.
Decision log and queued work tracked in `argon_seo2.md`.
