/**
 * Central inventory service — the SINGLE SOURCE OF TRUTH for sellable stock
 * (roadmap C). Every sale channel (website checkout, PayPal webhook, admin
 * confirm, eBay order) must claim stock through this module; nothing may
 * UPDATE products.stock_count directly elsewhere.
 *
 * Invariants (spec):
 *   - Atomic conditional decrement: stock can never go negative, and two
 *     concurrent buyers can never both claim the last unit.
 *   - Availability flag follows stock: >0 → in-stock, 0 → out-of-stock.
 *   - Never decreases stock without a guarded WHERE (row-count verified).
 *   - eBay mirrors are updated AFTER central stock commits (never before),
 *     asynchronously — a failed eBay push never rolls back central stock.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'

const log = logger.child({ context: 'central-inventory' })

export type InventoryChannel = 'website' | 'paypal' | 'admin' | 'ebay' | 'offer'

export interface DecreaseResult {
  ok: boolean
  remaining: number
  reason?: 'not-found' | 'insufficient-stock'
}

/** Set the availability flag to match stock — the website's out-of-stock UI reads this. */
async function syncAvailabilityFlag(productId: string, stockCount: number): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { availability: true },
  }).catch((err) => {
    log.error({ err, productId }, 'Availability flag read failed')
    return null
  })
  if (!product) return
  // `sourced` and `emergency` are deliberate merchandising states (procurement
  // availability), not stock-derived ones. A sale must not silently turn an
  // emergency-listed part into a normal listing.
  if (product.availability === 'sourced' || product.availability === 'emergency') return

  await prisma.product.update({
    where: { id: productId },
    data: { availability: stockCount > 0 ? 'in-stock' : 'out-of-stock' },
  }).catch((err) => log.error({ err, productId }, 'Availability flag sync failed'))
}

/**
 * Atomically decrease stock for one product. The conditional UPDATE is the
 * race-condition guard: concurrent callers serialize in Postgres and only one
 * can take the last unit (affected-rows check). Never throws for stock
 * problems — returns ok:false so callers follow existing failure rules.
 */
export async function decreaseStock(
  productId: string,
  quantity: number,
  channel: InventoryChannel,
  reference?: { orderId?: string; note?: string },
): Promise<DecreaseResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, remaining: -1, reason: 'insufficient-stock' }
  }

  // Atomic conditional decrement — the preferred pattern from the spec:
  //   UPDATE products SET stock_count = stock_count - q
  //   WHERE id = ? AND stock_count >= q
  const affected = await prisma.$executeRawUnsafe(
    'UPDATE products SET stock_count = stock_count - $1 WHERE id = $2::uuid AND stock_count >= $1',
    quantity, productId,
  )

  if (affected === 0) {
    // Either the product vanished, or another channel just claimed the stock.
    const exists = await prisma.product.findUnique({ where: { id: productId }, select: { stockCount: true } })
    if (!exists) return { ok: false, remaining: 0, reason: 'not-found' }
    log.warn({ productId, quantity, channel, reference, current: exists.stockCount },
      'Inventory decrement refused — insufficient stock (possible concurrent sale)')
    return { ok: false, remaining: exists.stockCount, reason: 'insufficient-stock' }
  }

  const updated = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stockCount: true, availability: true },
  })

  // Availability flag follows central stock immediately (website reads this).
  await syncAvailabilityFlag(productId, updated.stockCount)

  log.info({ productId, quantity, channel, remaining: updated.stockCount, reference },
    'Central inventory decreased')

  // eBay mirrors are synced asynchronously AFTER the central commit — central
  // stock is authoritative; an eBay failure never rolls it back.
  void enqueueEbayQuantitySync(productId).catch((err) =>
    log.error({ err, productId }, 'eBay sync enqueue failed (central stock remains authoritative)'))

  return { ok: true, remaining: updated.stockCount }
}

/**
 * Atomically increase stock (restock / cancellation restore / admin manual
 * change). Uses the same service so ALL stock movement is logged + synced.
 */
export async function increaseStock(
  productId: string,
  quantity: number,
  channel: InventoryChannel,
  reference?: { orderId?: string; note?: string },
): Promise<DecreaseResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, remaining: -1, reason: 'not-found' }
  }

  await prisma.$executeRawUnsafe(
    'UPDATE products SET stock_count = stock_count + $1 WHERE id = $2::uuid',
    quantity, productId,
  )

  const updated = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stockCount: true },
  })

  await syncAvailabilityFlag(productId, updated.stockCount)

  log.info({ productId, quantity, channel, remaining: updated.stockCount, reference },
    'Central inventory increased')

  void enqueueEbayQuantitySync(productId).catch((err) =>
    log.error({ err, productId }, 'eBay sync enqueue failed'))

  return { ok: true, remaining: updated.stockCount }
}

/**
 * Admin absolute set (form edit: stock 5 → 3). Computes the delta and routes
 * it through increase/decrease so the eBay sync and availability flag always
 * engage. This is the ONLY sanctioned way to write stockCount outside the
 * atomic paths.
 */
export async function setStock(
  productId: string,
  newQuantity: number,
  note?: string,
): Promise<DecreaseResult> {
  if (!Number.isInteger(newQuantity) || newQuantity < 0) {
    return { ok: false, remaining: -1, reason: 'not-found' }
  }
  const current = await prisma.product.findUnique({ where: { id: productId }, select: { stockCount: true } })
  if (!current) return { ok: false, remaining: 0, reason: 'not-found' }

  const delta = newQuantity - current.stockCount
  if (delta === 0) return { ok: true, remaining: current.stockCount }

  if (delta > 0) {
    return increaseStock(productId, delta, 'admin', { note })
  }
  // Manual decrease must respect the same guard (never below zero).
  const res = await decreaseStock(productId, -delta, 'admin', { note })
  if (!res.ok && res.reason === 'insufficient-stock') {
    // Stock was changed concurrently; retry once toward the absolute target.
    const fresh = await prisma.product.findUnique({ where: { id: productId }, select: { stockCount: true } })
    if (fresh && fresh.stockCount !== newQuantity) return setStock(productId, newQuantity, note)
  }
  return res
}

/**
 * Enqueue an eBay quantity sync for every listing mapped to this product.
 * Sets status='sync-pending' rows are processed by the retry scheduler
 * (ebaySyncScheduler). Idempotent per listing — re-enqueue is harmless.
 */
export async function enqueueEbayQuantitySync(productId: string): Promise<number> {
  const res = await prisma.ebayListing.updateMany({
    where: { productId, status: { in: ['published', 'synced', 'sync-failed', 'sync-pending'] } },
    data: { status: 'sync-pending' },
  })
  if (res.count > 0) log.info({ productId, listings: res.count }, 'eBay quantity sync enqueued')
  return res.count
}

/** Central stock read used by admin views and reconciliation. */
export async function getCentralStock(productId: string): Promise<number | null> {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { stockCount: true } })
  return p?.stockCount ?? null
}
