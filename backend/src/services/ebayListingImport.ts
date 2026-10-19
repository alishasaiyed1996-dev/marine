/**
 * Import live (legacy) eBay listings into the ebay_listings mirror.
 *
 * Listings created through Seller Hub / cross-listing tools are invisible to
 * the Inventory API — GetMyeBaySelling (Trading API) is the only way to see
 * them. Import matches every live listing to a central product BY SKU and
 * mirrors it as one row per (sku, marketplace): ebayOfferId stays null and
 * ebayListingId carries the legacy ItemID, so the sync scheduler pushes
 * quantities through ReviseInventoryStatus for these rows.
 *
 * Modes (central stock only becomes authoritative when the admin says so):
 *  - observe (default): rows land as 'imported'. Order→stock claims work for
 *    matched SKUs immediately, but central stock is NOT pushed to eBay.
 *  - activate: rows become 'sync-pending' so the next sync sweep pushes
 *    central stock to every linked legacy listing.
 *
 * Re-running is safe: existing (sku, marketplace) rows are left untouched;
 * unmatched SKUs are reported back for product-side mapping. Rows imported
 * in observe mode are flipped to sync-pending on the first activate run.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { fetchActiveSellerListings } from './ebayTradingClient.js'

const log = logger.child({ context: 'ebay-import' })

export type EbayImportResult = {
  scanned: number
  matchedPairs: number
  imported: number
  alreadyMapped: number
  skippedNoSku: number
  unmatchedSkuCount: number
  unmatchedSamples: string[]
  activated: number
}

export async function importActiveListings(activate = false): Promise<EbayImportResult> {
  const listings = await fetchActiveSellerListings()

  // One pass over the catalog: trimmed SKU → product (first wins).
  const products = await prisma.product.findMany({
    where: { status: { not: 'archived' } },
    select: { id: true, sku: true },
  })
  const bySku = new Map<string, { id: string; sku: string }>()
  for (const p of products) {
    const key = p.sku.trim()
    if (key && !bySku.has(key)) bySku.set(key, { id: p.id, sku: p.sku })
  }

  const unmatched = new Set<string>()
  const pairs: Array<{ productId: string; sku: string; marketplace: string; itemId: string; qty: number }> = []
  let skippedNoSku = 0
  for (const l of listings) {
    if (!l.sku) { skippedNoSku++; continue }
    const product = bySku.get(l.sku)
    if (!product) { unmatched.add(l.sku); continue }
    pairs.push({ productId: product.id, sku: l.sku, marketplace: l.marketplace || 'EBAY_US', itemId: l.itemId, qty: l.quantity })
  }

  // Which (sku, marketplace) mirrors already exist?
  const pairSkus = [...new Set(pairs.map((p) => p.sku))]
  const existing = pairSkus.length > 0
    ? await prisma.ebayListing.findMany({ where: { sku: { in: pairSkus } }, select: { sku: true, marketplace: true } })
    : []
  const existingKeys = new Set(existing.map((e) => `${e.sku}|${e.marketplace}`))

  const seenKeys = new Set<string>()
  const toCreate = pairs.filter((p) => {
    const key = `${p.sku}|${p.marketplace}`
    if (existingKeys.has(key) || seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })

  let imported = 0
  if (toCreate.length > 0) {
    const created = await prisma.ebayListing.createMany({
      data: toCreate.map((p) => ({
        productId: p.productId,
        sku: p.sku,
        marketplace: p.marketplace,
        ebayOfferId: null,
        ebayListingId: p.itemId,
        status: activate ? 'sync-pending' : 'imported',
        lastSyncedQty: activate ? null : p.qty,
        lastSyncAt: activate ? null : new Date(),
      })),
      skipDuplicates: true, // unique(sku, marketplace) — race/duplicate safety
    })
    imported = created.count
  }

  let activated = 0
  if (activate) {
    // Flip rows imported earlier in observe mode (legacy only — never touch
    // Inventory-API offers created by the app, which carry an ebayOfferId).
    const flipped = await prisma.ebayListing.updateMany({
      where: { status: 'imported', ebayOfferId: null },
      data: { status: 'sync-pending', lastSyncedQty: null, lastError: null },
    })
    activated = flipped.count
  }

  const result: EbayImportResult = {
    scanned: listings.length,
    matchedPairs: pairs.length,
    imported,
    alreadyMapped: pairs.length - toCreate.length,
    skippedNoSku,
    unmatchedSkuCount: unmatched.size,
    unmatchedSamples: [...unmatched].sort().slice(0, 25),
    activated,
  }
  log.info({ ...result }, 'eBay legacy listing import completed')
  return result
}
