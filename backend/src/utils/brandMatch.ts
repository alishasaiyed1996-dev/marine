/**
 * Manufacturer → Brand matching for the catalogue backfill.
 *
 * The eBay catalogue import populated `products.manufacturer` (free text) but
 * never linked the `brand` relation, so every product has `brand_id = NULL`.
 * That leaves the brand tier of the site empty: no brand hubs, no
 * product→brand links, and no `brand` in Product JSON-LD.
 *
 * This module is the single source of truth for the mapping decision. It is
 * deliberately pure (no Prisma, no I/O) so it can be unit-tested against the
 * real catalogue data and so the script, and any future admin tool, cannot
 * disagree about what a manufacturer maps to.
 *
 * The mapping is intentionally conservative: combined listings ("TITAN /
 * GEARENCH"), non-brand values ("UNBRANDED") and one-off no-name items are
 * reported as unlinked rather than turned into brand pages.
 */

import { generateSlug } from './helpers.js'

export interface ProductForBrandMatch {
  id: string
  manufacturer: string | null
  name: string
  sku: string | null
  brandId: string | null
}

export interface ExistingBrand {
  id: string
  name: string
  slug: string
}

export interface BrandCreatePlan {
  /** Display name taken from the catalogue's own spelling. */
  name: string
  slug: string
  /** The normalised manufacturer key this brand covers. */
  manufacturerKey: string
  productIds: string[]
}

export interface BrandLinkPlan {
  brandId: string
  brandName: string
  manufacturerKey: string
  productIds: string[]
}

export interface UnlinkedGroup {
  manufacturer: string
  count: number
  reason: string
}

export interface BrandMatchPlan {
  creates: BrandCreatePlan[]
  links: BrandLinkPlan[]
  unlinked: UnlinkedGroup[]
  alreadyLinked: number
  noManufacturer: number
  /** Products that would gain a brandId if this plan is applied. */
  linkableProducts: number
  totalProducts: number
}

/** Values that appear in `manufacturer` but are not brands. */
export const NON_BRAND_VALUES = new Set([
  'UNBRANDED',
  'UN BRANDED',
  'UNKNOWN',
  'NONE',
  'NA',
  'N A',
  'NO NAME',
  'NO BRAND',
  'MISC',
  'MISCELLANEOUS',
  'OTHER',
  'OTHERS',
  'GENERIC',
  'VARIOUS',
  'ASSORTED',
  'BULK',
  'OEM',
  'AFTERMARKET',
  'CUSTOM',
  'TBD',
])

/** A brand name shorter than this is too ambiguous to publish. */
export const MIN_BRAND_NAME_LENGTH = 3

/**
 * Normalise a manufacturer string for comparison: diacritics folded, case
 * insensitive, punctuation collapsed to single spaces. "Pepperl+Fuchs" and
 * "PEPPERL FUCHS" both become "PEPPERL FUCHS"; the seed brand "Wärtsilä" and
 * a catalogue value of "WARTSILA" both become "WARTSILA".
 */
export function normalizeBrandKey(value: string | null | undefined): string {
  return String(value ?? '')
    // NFKD splits accented characters into base + combining mark, so the mark
    // can be stripped and "Wärtsilä" compares equal to "WARTSILA".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Whether a manufacturer value may become a public brand page.
 * Rejects non-brand placeholder values, combined listings, and names too short
 * to be meaningful.
 */
export function isUsableBrandName(value: string): boolean {
  const name = String(value || '').trim()
  if (!name) return false
  // Combined listings such as "TITAN / GEARENCH" are two brands, not one.
  if (name.includes('/')) return false

  const key = normalizeBrandKey(name)
  if (!key) return false
  if (NON_BRAND_VALUES.has(key)) return false
  // Must contain at least one letter (a pure model number is not a brand).
  if (!/[A-Z]/.test(key)) return false
  // Length is measured without spaces so "K BUS" still counts as 4.
  if (key.replace(/\s+/g, '').length < MIN_BRAND_NAME_LENGTH) return false

  return true
}

/**
 * Pick the display name for a manufacturer group from the catalogue's own
 * spellings: the most common original casing wins (so "PROTO" beats "Proto"
 * when the catalogue mostly says "PROTO"). No casing is invented.
 *
 * Ties break on plain code-point order rather than localeCompare, so the
 * result does not depend on the machine's locale/ICU data.
 */
export function deriveBrandName(variants: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [value, count] of variants) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value
      bestCount = count
    }
  }
  return best.trim()
}

/** Slug that does not collide with any existing or already-planned brand. */
function uniqueSlug(base: string, used: Set<string>): string {
  const slug = base || 'brand'
  if (!used.has(slug)) {
    used.add(slug)
    return slug
  }
  let n = 2
  while (used.has(`${slug}-${n}`)) n += 1
  const result = `${slug}-${n}`
  used.add(result)
  return result
}

/**
 * Build the full backfill plan without touching the database.
 *
 * A manufacturer group is matched to an existing brand when their normalised
 * names are equal. Otherwise it becomes a new brand when it is a usable name
 * and meets the product-count threshold; everything else is reported as
 * unlinked so a human can decide.
 */
export function buildBrandPlan(input: {
  products: ProductForBrandMatch[]
  existingBrands: ExistingBrand[]
  minProducts?: number
  extraExcludes?: string[]
  /** Slugs already taken by brand_slug_history (old URLs must keep working). */
  reservedSlugs?: string[]
}): BrandMatchPlan {
  const minProducts = input.minProducts ?? 3
  const extraExcludes = new Set((input.extraExcludes ?? []).map(normalizeBrandKey).filter(Boolean))

  const brandByKey = new Map<string, ExistingBrand>()
  const usedSlugs = new Set<string>(input.reservedSlugs ?? [])
  for (const brand of input.existingBrands) {
    brandByKey.set(normalizeBrandKey(brand.name), brand)
    usedSlugs.add(brand.slug)
  }

  interface Group {
    variants: Map<string, number>
    products: string[]
  }
  const groups = new Map<string, Group>()
  let alreadyLinked = 0
  let noManufacturer = 0

  for (const product of input.products) {
    if (product.brandId) {
      alreadyLinked += 1
      continue
    }
    const raw = String(product.manufacturer ?? '').trim()
    const key = normalizeBrandKey(raw)
    if (!key) {
      noManufacturer += 1
      continue
    }
    let group = groups.get(key)
    if (!group) {
      group = { variants: new Map(), products: [] }
      groups.set(key, group)
    }
    group.variants.set(raw, (group.variants.get(raw) ?? 0) + 1)
    group.products.push(product.id)
  }

  const creates: BrandCreatePlan[] = []
  const links: BrandLinkPlan[] = []
  const unlinked: UnlinkedGroup[] = []

  for (const [key, group] of groups) {
    const name = deriveBrandName(group.variants)
    const count = group.products.length

    const existing = brandByKey.get(key)
    if (existing) {
      links.push({ brandId: existing.id, brandName: existing.name, manufacturerKey: key, productIds: group.products })
      continue
    }

    if (extraExcludes.has(key)) {
      unlinked.push({ manufacturer: name, count, reason: 'excluded on the command line' })
      continue
    }
    if (!isUsableBrandName(name)) {
      unlinked.push({ manufacturer: name, count, reason: 'not a usable brand name (placeholder, combined listing, or too short)' })
      continue
    }
    if (count < minProducts) {
      unlinked.push({ manufacturer: name, count, reason: `below the ${minProducts}-product threshold` })
      continue
    }

    creates.push({
      name,
      slug: uniqueSlug(generateSlug(name), usedSlugs),
      manufacturerKey: key,
      productIds: group.products,
    })
  }

  creates.sort((a, b) => b.productIds.length - a.productIds.length)
  links.sort((a, b) => b.productIds.length - a.productIds.length)
  unlinked.sort((a, b) => b.count - a.count)

  const linkableProducts =
    creates.reduce((sum, c) => sum + c.productIds.length, 0) +
    links.reduce((sum, l) => sum + l.productIds.length, 0)

  return {
    creates,
    links,
    unlinked,
    alreadyLinked,
    noManufacturer,
    linkableProducts,
    totalProducts: input.products.length,
  }
}
