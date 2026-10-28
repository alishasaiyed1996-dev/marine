/**
 * Reclaims units reserved by stale unpaid PayPal checkouts (audit B10).
 *
 * capturePaypalOrder claims a reservation (`stockReserved` → true) BEFORE
 * charging, and every ordinary failure path releases it again — but a hard
 * process crash between the claim/reserve and PayPal's answer strands the
 * units: the shelf is empty while the order sits pending forever, and the
 * reservation semantic boundary stays crossed.
 *
 * The sweep releases those units for resale, with the same house pattern as
 * offerExpiryScheduler (fixed setInterval, guarded flips so concurrent
 * instances cannot double-apply):
 *
 *  - PayPal checkouts only — bank-transfer and L/C orders live in 'pending'
 *    with claimed stock for days by design (orderSweepRules guards this).
 *  - paymentStatus AND status 'pending' — a paid/cancelled order owns its
 *    stock story already; the sweep never revisits it.
 *  - stale age default 24h (ORDER_SWEEP_STALE_HOURS) — generous so a buyer
 *    relaunching an old checkout the next day still pays cleanly.
 *  - quiet window on updatedAt (ORDER_SWEEP_QUIET_MINUTES, default 60) — the
 *    capture claim flips stockReserved with updateMany seconds before
 *    reserveStock, which bumps updatedAt; a recently touched row is therefore
 *    never swept mid-capture.
 *
 * The flip is an atomic guarded updateMany and only the path—that flips
 * true→false may release units (same ownership rule as the capture abort
 * path): a swept order that a live capture re-claims later simply re-runs the
 * normal claim → reserve → capture → webhook sequence.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { releaseReservation } from './centralInventory.js'
import {
  isSweepCandidate,
  sweepIntervalFromEnv,
  sweepWindowFromEnv,
} from './orderSweepRules.js'

const log = logger.child({ context: 'order-stock-sweep' })

const FIRST_RUN_DELAY_MS = 60 * 1000
const BATCH_SIZE = 50

export async function sweepStaleReservedOrders(now: Date = new Date()): Promise<number> {
  const window = sweepWindowFromEnv()
  const staleBefore = new Date(now.getTime() - window.staleHours * 3_600_000)
  const quietBefore = new Date(now.getTime() - window.quietMinutes * 60_000)

  const orders = await prisma.order.findMany({
    where: {
      paymentMethod: 'paypal',
      paymentStatus: 'pending',
      status: 'pending',
      stockReserved: true,
      createdAt: { lt: staleBefore },
      updatedAt: { lt: quietBefore },
    },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  })

  let released = 0
  for (const order of orders) {
    // Defence in depth: the DB prefilter and this pure rule share one source
    // (orderSweepRules), so an edit that breaks either breaks the tests first.
    if (!isSweepCandidate(order, now, window)) continue

    // Only the path that flips the ownership marker may release the units.
    const claim = await prisma.order.updateMany({
      where: {
        id: order.id,
        stockReserved: true,
        paymentStatus: 'pending',
        status: 'pending',
      },
      data: { stockReserved: false },
    })
    if (claim.count === 0) continue

    const lines = order.items
      .filter((item) => item.productId)
      .map((item) => ({ productId: item.productId as string, quantity: item.quantity }))
    if (lines.length > 0) {
      try {
        await releaseReservation(lines, 'paypal', {
          orderId: order.id,
          note: 'Stale unpaid PayPal checkout swept — units returned to the shelf',
        })
      } catch (err) {
        // The marker was already released; log loudly so any partial release
        // is visible. releaseReservation is per-line raw SQL and only throws
        // on infrastructure errors.
        log.error({ err, orderId: order.id, lines }, 'Stock release failed during stale-checkout sweep')
      }
    }

    await prisma.orderTimeline.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: `Stale unpaid PayPal checkout (older than ${window.staleHours}h) — reserved stock released for resale.`,
      },
    })

    released++
    log.info({ orderId: order.id, orderNumber: order.orderNumber, lines: lines.length }, 'Stale reservation swept')
  }

  if (released > 0) log.info({ released, scanned: orders.length }, 'Stale-checkout stock sweep finished')
  return released
}

let interval: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null

export function startOrderStockSweepScheduler(intervalMs?: number) {
  if (interval) return

  const minutes = sweepIntervalFromEnv()
  const ms = intervalMs ?? minutes * 60_000

  firstRun = setTimeout(() => {
    void sweepStaleReservedOrders().catch((err) => log.error({ err }, 'Stale-checkout stock sweep crashed'))
  }, FIRST_RUN_DELAY_MS)

  interval = setInterval(() => {
    void sweepStaleReservedOrders().catch((err) => log.error({ err }, 'Stale-checkout stock sweep crashed'))
  }, ms)

  log.info({ intervalMinutes: Math.round(ms / 60_000) }, 'Stale-checkout stock sweep scheduler started')
}

export function stopOrderStockSweepScheduler() {
  if (firstRun) { clearTimeout(firstRun); firstRun = null }
  if (interval) { clearInterval(interval); interval = null }
}
