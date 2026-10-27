/**
 * Reference copy for brand hubs.
 *
 * The hub indexability rule (src/utils/hubSeo.ts) requires a description of
 * 120+ characters, an SEO title and an SEO description of 80+ characters.
 * Freshly backfilled brands have all three empty, so their hubs render
 * 200-but-noindex forever and never enter the sitemap. The backfill script
 * fills ONLY empty fields with copy derived from each brand's own catalogue
 * (published product count, the categories its products actually cover).
 *
 * Deliberately pure (string → string): unit-tested here, and any future admin
 * tool can reuse it without disagreeing with the script.
 */

export interface BrandHubCopyInput {
  brandName: string
  /** Number of published products for this brand. */
  productCount: number
  /** Category names covered by the brand's published products (may be empty). */
  categories: string[]
}

export interface BrandHubCopy {
  description: string
  seoTitle: string
  seoDescription: string
}

/**
 * "A, B, C and D" for n ≥ 3; "A and B" for 2; the value itself for 1.
 * Locale-independent enough for en-only hub copy.
 */
function naturalList(values: string[]): string {
  const clean = values.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`
}

export function buildBrandHubCopy(input: BrandHubCopyInput): BrandHubCopy {
  const brand = String(input.brandName || '').trim()
  const count = Math.max(0, Number(input.productCount) || 0)

  // Four categories give the copy real, verifiable substance without turning
  // the description into a category dump; the hub page lists the full range.
  const covered = naturalList(input.categories.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 4))

  const description = covered
    ? `${brand} spare parts for sale at Alka Traders — ${count} inspected and published items spanning ${covered}. Every listing carries its part number, condition notes and lead time, and the sourcing desk also locates ${brand} items that are not listed online yet.`
    : `${brand} spare parts for sale at Alka Traders — ${count} inspected and published items across the marine and industrial range. Every listing carries its part number, condition notes and lead time, and the sourcing desk also locates ${brand} items that are not listed online yet.`

  // Keep the SERP title short. The server appends "| Alka Traders" only when
  // the title has room for it (see withBrandSuffix in server.js), so baking a
  // long suffix into the SEO title would shear it off; the plain form is the
  // safe fallback for unusually long brand names.
  const withSuffix = `${brand} spare parts | Alka Traders`
  const seoTitle = withSuffix.length <= 65 ? withSuffix : `${brand} spare parts`

  const seoDescription = `${count} ${brand} spare parts ready to ship from Alka Traders — inspected and dispatched with tracking. Send your part number for a fast quote.`

  return { description, seoTitle, seoDescription }
}
