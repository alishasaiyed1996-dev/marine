import crypto from 'crypto'

// ─── Slug Generation ───────────────────────────────────────────
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Normalize an admin-entered URL slug and reject values that cannot be used. */
export function assertValidSlug(value: string): string {
  const slug = generateSlug(String(value || '')).slice(0, 200).replace(/-+$/g, '')
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw Object.assign(
      new Error('URL slug must contain lowercase letters, numbers and single hyphens (for example: caterpillar-3512b).'),
      { status: 400 },
    )
  }
  return slug
}


// ─── Order Number Generation (DB-backed) ──────────────────────
export async function generateOrderNumber(): Promise<string> {
  // Use UUID-based prefix for uniqueness across multi-instance deployments
  const shortUuid = crypto.randomUUID().split('-')[0].toUpperCase()
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `AT-ORD-${shortUuid}-${timestamp}${random}`
}

// ─── RFQ Number Generation (DB-backed) ─────────────────────────
export async function generateRfqNumber(): Promise<string> {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `AT-${timestamp}${random}`
}

// ─── Offer Number Generation (DB-backed) ──────────────────────
export async function generateOfferNumber(): Promise<string> {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `OFF-${timestamp}${random}`
}

// ─── Pagination Helper ─────────────────────────────────────────
export function paginationParams(page?: number, limit?: number) {
  const p = Math.max(1, Number(page) || 1)
  const l = Math.min(100, Math.max(1, Number(limit) || 24))
  const skip = (p - 1) * l
  return { page: p, limit: l, skip }
}

// ─── Pagination Response ───────────────────────────────────────
export function paginationResponse(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  }
}

// ─── Setting Helpers ──────────────────────────────────────────
/**
 * Parse a numeric setting/env value while preserving a legitimate 0 (free
 * shipping, 0% tax, free-shipping threshold of 0). Missing, empty, or
 * non-numeric values fall back to the supplied default.
 */
export function numberOrDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// ─── Price Helpers ─────────────────────────────────────────────
export function getEffectivePrice(product: {
  regularPrice: any
  salePrice?: any | null
  saleStartsAt?: Date | null
  saleEndsAt?: Date | null
}): number {
  const regular = Number(product.regularPrice)
  if (!product.salePrice) return regular

  const sale = Number(product.salePrice)
  const now = new Date()

  if (product.saleStartsAt && now < product.saleStartsAt) return regular
  if (product.saleEndsAt && now > product.saleEndsAt) return regular

  return sale < regular ? sale : regular
}

export function isOnSale(product: {
  regularPrice: any
  salePrice?: any | null
  saleStartsAt?: Date | null
  saleEndsAt?: Date | null
}): boolean {
  const effective = getEffectivePrice(product)
  const regular = Number(product.regularPrice)
  return effective < regular
}

/** A product is buyable only when it has units AND is not explicitly marked
 * out of stock via its availability. */
export function isProductInStock(product: { stockCount: number; availability: string }): boolean {
  return product.availability !== 'out-of-stock' && product.stockCount > 0
}
