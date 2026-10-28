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
 * Claims stock for several order lines as ONE unit of work.
 *
 * Every line is decremented inside a single transaction: either all lines are
 * claimed or none are. This is what makes "reserve before charging the
 * customer" safe — a partial claim can never be left behind, and two
 * concurrent buyers can never both claim the last unit.
 *
 * The caller owns the release: if the payment that follows the reservation
 * fails, `releaseReservation` must put the units back.
 */
export async function reserveStock(
  lines: { productId: string; quantity: number }[],
  channel: InventoryChannel,
  reference?: { orderId?: string; note?: string },
): Promise<{
  ok: boolean
  reserved: { productId: string; quantity: number }[]
  failedProductId?: string
  reason?: 'not-found' | 'insufficient-stock' | 'invalid-quantity'
}> {
  const valid = lines.filter(l => l.productId && Number.isInteger(l.quantity) && l.quantity > 0)
  if (valid.length === 0) {
    return { ok: true, reserved: [] }
  }

  try {
    const reserved = await prisma.$transaction(async (tx) => {
      const claimed: { productId: string; quantity: number }[] = []
      for (const line of valid) {
        const affected = await tx.$executeRawUnsafe(
          'UPDATE products SET stock_count = stock_count - $1 WHERE id = $2::uuid AND stock_count >= $1',
          line.quantity, line.productId,
        )
        if (affected === 0) {
          throw new ReservationError(line.productId, 'insufficient-stock')
        }
        claimed.push(line)
      }
      return claimed
    })

    // Post-commit side effects: the availability flag and the eBay mirror
    // follow central stock, never the other way round.
    for (const line of reserved) {
      const product = await prisma.product.findUnique({
        where: { id: line.productId },
        select: { stockCount: true },
      })
      if (product) await syncAvailabilityFlag(line.productId, product.stockCount)
    }
    for (const line of reserved) {
      void enqueueEbayQuantitySync(line.productId).catch((err) =>
        log.error({ err, productId: line.productId }, 'eBay sync enqueue failed (central stock remains authoritative)'))
    }

    log.info({ reserved, channel, reference }, 'Central inventory reserved for order')
    return { ok: true, reserved }
  } catch (err) {
    if (err instanceof ReservationError) {
      log.warn({ productId: err.productId, channel, reference }, 'Inventory reservation refused - insufficient stock')
      return { ok: false, reserved: [], failedProductId: err.productId, reason: err.reason }
    }
    log.error({ err, channel, reference }, 'Inventory reservation failed')
    return { ok: false, reserved: [], reason: 'not-found' }
  }
}

/** Puts a reservation back into stock (payment failed after the claim). */
export async function releaseReservation(
  reserved: { productId: string; quantity: number }[],
  channel: InventoryChannel,
  reference?: { orderId?: string; note?: string },
): Promise<void> {
  for (const line of reserved) {
    if (!line.productId || !Number.isInteger(line.quantity) || line.quantity <= 0) continue
    await prisma.$executeRawUnsafe(
      'UPDATE products SET stock_count = stock_count + $1 WHERE id = $2::uuid',
      line.quantity, line.productId,
    )
    const product = await prisma.product.findUnique({
      where: { id: line.productId },
      select: { stockCount: true },
    })
    if (product) await syncAvailabilityFlag(line.productId, product.stockCount)
    void enqueueEbayQuantitySync(line.productId).catch((err) =>
      log.error({ err, productId: line.productId }, 'eBay sync enqueue failed'))
    log.info({ productId: line.productId, quantity: line.quantity, channel, reference }, 'Inventory reservation released')
  }
}

/** Internal signal that a line could not be claimed. */
class ReservationError extends Error {
  constructor(public productId: string, public reason: 'insufficient-stock' | 'not-found') {
    super(`Reservation failed for ${productId}: ${reason}`)
    this.name = 'ReservationError'
  }
}

/**
 * Admin absolute set (form edit: stock 5 → 3). Computes the delta and routes
 * it through increase/decrease so the eBay sync and availability flag always
 * engage. This is the ONLY sanctioned way to write stockCount outside the
 * atomic paths.
 */export async function setStock(
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
 * Sets status='sync-pending' and immediately requests one push pass
 * (requestSyncTick) — near-real-time convergence after any stock change.
 * Re-enqueue is idempotent per listing; a failed kick falls back to the
 * 10-minute scheduler sweep. Nothing here can fail or roll back the central
 * stock change that produced the call.
 */
export async function enqueueEbayQuantitySync(productId: string): Promise<number> {
  const res = await prisma.ebayListing.updateMany({
    where: { productId, status: { in: ['published', 'synced', 'sync-failed', 'sync-pending'] } },
    data: { status: 'sync-pending' },
  })
  if (res.count > 0) {
    log.info({ productId, listings: res.count }, 'eBay quantity sync enqueued')
    // Dynamic import keeps the module graph acyclic (the scheduler pulls the
    // order service, which pulls this module). Fire-and-forget: the kick is a
    // latency optimization, the timed sweep remains the durability net.
    void import('./ebaySyncScheduler.js')
      .then((sync) => sync.requestSyncTick())
      .catch((err) => log.warn({ err, productId }, 'eBay sync kick unavailable (timed sweep will catch up)'))
  }
  return res.count
}

/** Central stock read used by admin views and reconciliation. */
export async function getCentralStock(productId: string): Promise<number | null> {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { stockCount: true } })
  return p?.stockCount ?? null
}
