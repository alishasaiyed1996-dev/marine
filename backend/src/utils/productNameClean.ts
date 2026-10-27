/**
 * Backend twin of the product-identity cleaning rules in
 * shared/product-page.mjs.
 *
 * The `api` service is built by Railway with rootDirectory "backend", so
 * production data scripts (backend/scripts/*.ts) CANNOT import
 * ../../shared/product-page.mjs — that file is not inside the built image.
 * The name/slug normalization path therefore uses this copy.
 *
 * KEEP IN SYNC: MARKETPLACE_NOISE_RE_SOURCE must stay character-for-character
 * equal to the source of MARKETPLACE_NOISE_RE in shared/product-page.mjs, and
 * cleanProductName must implement the same three steps:
 *   1. remove marketplace shipping words ("fast ship", "free shipping", …),
 *   2. collapse immediately repeated tokens ("A5-SG A5-SG" → "A5-SG"),
 *   3. tidy whitespace and trailing separators.
 * backend/src/utils/productNameClean.test.ts fails the suite when either
 * side drifts.
 */

export const MARKETPLACE_NOISE_RE_SOURCE =
  String.raw`\b(?:fed\s*ex|fedex|fast\s*ship|fastship|free\s*shipping|worldwide\s*shipping|express\s*shipping|new\s*fast\s*ship|new\s*fastship|ship\s*free)\b`

export const MARKETPLACE_NOISE_RE = new RegExp(MARKETPLACE_NOISE_RE_SOURCE, 'gi')

const TRAILING_SEPARATOR_RE = /[\s,;:|/–—-]+$/

function tidy(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Collapse immediately repeated tokens ("A5-SG A5-SG" → "A5-SG"). */
function dedupeAdjacentTokens(value: string): string {
  const tokens = tidy(value).split(' ')
  const out: string[] = []
  for (const token of tokens) {
    if (!token) continue
    const previous = out[out.length - 1]
    if (previous && previous.toLowerCase() === token.toLowerCase()) continue
    out.push(token)
  }
  return out.join(' ')
}

/** Marketplace shipping words that should never be part of a product identity. */
export function cleanProductName(value: string | null | undefined): string {
  return dedupeAdjacentTokens(String(value ?? '').replace(MARKETPLACE_NOISE_RE, ' '))
    .replace(/\s+/g, ' ')
    .replace(TRAILING_SEPARATOR_RE, '')
}
