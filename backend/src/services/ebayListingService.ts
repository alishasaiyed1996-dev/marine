/**
 * eBay listing creation (roadmap C25).
 *
 * Admin lists a product to eBay; the INITIAL and ALWAYS quantity comes from
 * CENTRAL INVENTORY — an offer can never be created with more sellable
 * quantity than the site actually has (spec: EBAY LISTING CREATION).
 *
 * Requires account-level configuration (policies, merchant location,
 * category) via env vars or the request body — eBay rejects offers without
 * them. Condition mapping: new/unused→NEW, refurbished→REFURBISHED, else USED.
 * This service creates the OFFER (inventory item is assumed to exist; the
 * admin flow creates it through eBay Seller Hub or a future endpoint) and
 * immediately pushes the central quantity to both inventory item and offer.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { getUserAccessToken, updateInventoryItemQuantity, updateOfferQuantity, isEbayConfigured } from './ebayClient.js'

const log = logger.child({ context: 'ebay-listings' })

const API_BASE = (process.env.EBAY_ENV || 'sandbox').toLowerCase() === 'production'
  ? 'https://api.ebay.com'
  : 'https://api.sandbox.ebay.com'

export interface CreateListingInput {
  productId: string
  marketplace?: string
  /** eBay category id — required by eBay for publishable offers. */
  categoryId: string
  /** Optional explicit price; defaults to the product's effective price. */
  price?: number
}

function mapCondition(condition: string): string {
  switch (condition) {
    case 'new':
    case 'unused': return 'NEW'
    case 'refurbished':
    case 'reconditioned': return 'REFURBISHED'
    default: return 'USED_EXCELLENT'
  }
}

/**
 * Create (or reattach) an eBay offer for a product with quantity pinned to
 * central stock. Returns the local listing row. Idempotent per sku+marketplace.
 */
export async function createListingForProduct(input: CreateListingInput, actorId: string) {
  if (!isEbayConfigured()) {
    throw Object.assign(new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'), { status: 503 })
  }

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, sku: true, name: true, status: true, condition: true, regularPrice: true, salePrice: true, stockCount: true },
  })
  if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })
  if (product.status !== 'published') {
    throw Object.assign(new Error('Only published products can be listed on eBay'), { status: 400 })
  }

  // ── Spec rule: listing quantity ≤ central available stock. ──
  const centralQty = product.stockCount
  const sale = product.salePrice != null ? Number(product.salePrice) : null
  const regular = Number(product.regularPrice) || 0
  const price = input.price ?? (sale != null && sale > 0 && sale < regular ? sale : regular)
  if (price <= 0) throw Object.assign(new Error('Product has no price — set one before listing'), { status: 400 })

  const marketplace = input.marketplace || 'EBAY_US'
  const listing = await prisma.ebayListing.upsert({
    where: { sku_marketplace: { sku: product.sku, marketplace } },
    create: { productId: product.id, sku: product.sku, marketplace, status: 'pending' },
    update: { productId: product.id }, // re-point if SKU moved products
  })

  const token = await getUserAccessToken()

  // ── Create or update the eBay offer. ──
  const offerPayload = {
    sku: product.sku,
    marketplaceId: marketplace,
    format: 'FIXED_PRICE',
    categoryId: input.categoryId,
    pricingSummary: { price: { value: price.toFixed(2), currency: 'USD' } },
    condition: mapCondition(product.condition),
    merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY,
    fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
    paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
    returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
  }

  let offerId = listing.ebayOfferId
  if (!offerId) {
    const res = await fetch(`${API_BASE}/sell/inventory/v1/offer/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(offerPayload),
    })
    const raw = await res.text()
    if (!res.ok) {
      await prisma.ebayListing.update({ where: { id: listing.id }, data: { status: 'sync-failed', lastError: raw.slice(0, 500) } })
      throw Object.assign(new Error(`eBay createOffer failed (${res.status}): ${raw.slice(0, 300)}`), { status: 502 })
    }
    const data = JSON.parse(raw) as { offerId: string }
    offerId = data.offerId
  } else {
    const res = await fetch(`${API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(offerPayload),
    })
    if (!res.ok) {
      const raw = await res.text()
      await prisma.ebayListing.update({ where: { id: listing.id }, data: { status: 'sync-failed', lastError: raw.slice(0, 500) } })
      throw Object.assign(new Error(`eBay updateOffer failed (${res.status}): ${raw.slice(0, 300)}`), { status: 502 })
    }
  }

  // Publish the offer (becomes a live listing). May already be published.
  let listingId = listing.ebayListingId
  if (!listingId && offerId) {
    const pub = await fetch(`${API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const raw = await pub.text()
    if (pub.ok) {
      const data = JSON.parse(raw) as { listingId?: string }
      listingId = data.listingId ?? null
    } else if (!/already/i.test(raw)) {
      // Publish failure is not fatal to the mapping — quantity sync continues.
      log.warn({ raw: raw.slice(0, 300), offerId }, 'eBay publish failed — offer stored unpublished')
    }
  }

  // Push central quantity to BOTH the inventory item and the offer.
  await updateInventoryItemQuantity(product.sku, centralQty).catch((err) =>
    log.warn({ err, sku: product.sku }, 'inventory item quantity push failed (offer push continues)'))
  await updateOfferQuantity(offerId, centralQty)

  const updated = await prisma.ebayListing.update({
    where: { id: listing.id },
    data: {
      ebayOfferId: offerId,
      ebayListingId: listingId ?? null,
      status: listingId ? 'synced' : 'published',
      lastSyncedQty: centralQty,
      lastSyncAt: new Date(),
      lastError: null,
    },
  })

  log.info({ productId: product.id, sku: product.sku, offerId, listingId, qty: centralQty, actorId },
    'eBay listing created/updated with central quantity')
  return updated
}
