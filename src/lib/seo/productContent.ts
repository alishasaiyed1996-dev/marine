/**
 * Shared product publishing rules used by the admin form and metadata
 * generator. Keep the description minimum in sync with
 * backend/src/services/productMutations.ts — the server re-checks every
 * publish request, so the client is only a convenience.
 */

export const MIN_PRODUCT_DESCRIPTION_CHARS = 300
export const MIN_PRODUCT_DESCRIPTION_WORDS = 50
export const PRODUCT_SEO_TITLE_MAX = 70
export const PRODUCT_SEO_DESCRIPTION_MIN = 80
export const PRODUCT_SEO_DESCRIPTION_MAX = 160

/** GS1 GTIN-8, GTIN-12, GTIN-13 or GTIN-14. IMPA codes are not GTINs. */
export const VALID_GTIN_PATTERN = /^(\d{8}|\d{12,14})$/

export function countWords(value: string | null | undefined): number {
  const text = String(value || '').trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * A product needs either 50 words or roughly 300 characters of description.
 * The OR keeps genuinely concise technical copy publishable while blocking
 * the old twenty-word stubs.
 */
export function meetsProductDescriptionMinimum(value: string | null | undefined): boolean {
  const text = String(value || '').trim()
  return text.length >= MIN_PRODUCT_DESCRIPTION_CHARS || countWords(text) >= MIN_PRODUCT_DESCRIPTION_WORDS
}

export function isValidGtin(value: string | null | undefined): boolean {
  const gtin = String(value || '').replace(/\s+/g, '')
  return VALID_GTIN_PATTERN.test(gtin)
}
