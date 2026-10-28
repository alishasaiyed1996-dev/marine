/**
 * eBay sync scheduler (roadmap C — eventual consistency).
 *
 * Follows the fixed-setInterval pattern of offerExpiryScheduler (no cron lib).
 *
 * Four jobs:
 *   1. pollRecentOrders — webhook-delivery net: recent Fulfillment orders run
 *      through the same idempotent processor. Order-level dedupe keeps stock
 *      claims single; failed orders retry on the next tick bucket.
 *   2. syncPendingListings — pushes CENTRAL stock to every eBay listing marked
 *      sync-pending, using the Inventory API offer id when present or the
 *      Trading API ItemID for imported listings. Central inventory is
 *      authoritative: failures never roll stock back, only mark the mirror
 *      unhealthy.
 *   3. reconcileEbayQuantities — detects drift between central stock and the
 *      last synced quantity (e.g. a missed webhook) and re-enqueues.
 *   4. retryPendingEvents — reprocesses deferred webhook events (temporary
 *      failures at delivery time) through the idempotent order processor.
 *
 * Plus an event-driven kick (requestSyncTick): every central stock change
 * marks the product's mirror rows 'sync-pending' (centralInventory) and asks
 * for an immediate push pass, so quantity updates reach eBay within seconds
 * instead of the next 10-minute sweep. Jobs 1-4 stay the timed safety net.
 * Draft/hidden products with a managed listing sync like published ones;
 * only archiving ends the relationship (mirrors sellableOnEbay in the order
 * processor).
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { isEbayConfigured, updateOfferQuantity, isRetryableError } from './ebayClient.js'
import { reviseTradingQuantity } from './ebayTradingService.js'

const log = logger.child({ context: 'ebay-sync' })

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000
const FIRST_RUN_DELAY_MS = 90 * 1000
const BATCH_SIZE = 50

/** Job 1: pull recent orders (webhook-delivery net). */
export async function pollRecentOrders(): Promise<number> {
  if (!isEbayConfigured()) return 0
  const { pollEbayOrders } = await import('./ebayOrderService.js')
  return pollEbayOrders()
}

/** Job 2: push central stock to eBay for all pending listings. */
export async function syncPendingListings(): Promise<{ synced: number; failed: number; skipped: number }> {
  const result = { synced: 0, failed: 0, skipped: 0 }
  if (!isEbayConfigured()) {
    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.02) {
      log.info('eBay not configured — sync sweep idle')
    }
    return result
  }

  const listings = await prisma.ebayListing.findMany({
    where: { status: 'sync-pending' },
    include: { product: { select: { stockCount: true, status: true, sku: true } } },
    take: BATCH_SIZE,
    orderBy: { updatedAt: 'asc' },
  })

  for (const listing of listings) {
    // Only ARCHIVING ends the sync relationship. Draft/hidden products with a
    // managed eBay listing keep selling there (imported items are drafts until
    // the publish gate is cleared), so central stock must keep converging for
    // them — otherwise a pre-publish sale leaves the central snapshot stale
    // and the first post-publish push resurrects already-sold units on eBay.
    if (listing.product.status === 'archived') {
      await prisma.ebayListing.update({
        where: { id: listing.id },
        data: { status: 'sync-failed', lastError: 'product archived — end the eBay listing' },
      })
      result.skipped++
      continue
    }

    // App-created listings sync through their Inventory-API offer id.
    // Imported (pre-existing Seller Hub) listings have no offer id, so they
    // sync through the Trading API's ItemID instead.
    const centralQty = listing.product.stockCount
    const offerId = listing.ebayOfferId
    const tradingItemId = listing.ebayListingId
    if (!offerId && !tradingItemId) {
      await prisma.ebayListing.update({
        where: { id: listing.id },
        data: { status: 'sync-failed', lastError: 'no eBay offer id or item id stored — cannot push quantity' },
      })
      result.skipped++
      continue
    }

    try {
      if (offerId) await updateOfferQuantity(offerId, centralQty)
      else await reviseTradingQuantity(tradingItemId as string, centralQty)
      await prisma.ebayListing.update({
        where: { id: listing.id },
        data: { status: 'synced', lastSyncedQty: centralQty, lastSyncAt: new Date(), lastError: null },
      })
      result.synced++
      log.info({ sku: listing.sku, offerId, qty: centralQty }, 'eBay quantity synced')
    } catch (err) {
      const retryable = isRetryableError(err)
      // NEVER roll back central stock because eBay failed (spec).
      await prisma.ebayListing.update({
        where: { id: listing.id },
        data: {
          status: retryable ? 'sync-pending' : 'sync-failed',
          lastError: (err as Error).message.slice(0, 500),
        },
      })
      result.failed++
      log.warn({ err, sku: listing.sku, retryable }, 'eBay quantity sync failed (central stock unchanged)')
    }
  }
  return result
}

/** Job 3: detect drift between central stock and the last pushed quantity. */
export async function reconcileEbayQuantities(): Promise<number> {
  if (!isEbayConfigured()) return 0

  const active = await prisma.ebayListing.findMany({
    where: { status: { in: ['synced', 'published', 'sync-failed'] } },
    include: { product: { select: { stockCount: true, status: true } } },
    // The whole mapped catalog is checked; 8k rows is small enough for an
    // in-memory compare, and drift rows are the only ones written back.
    orderBy: { updatedAt: 'asc' },
  })

  let drifted = 0
  for (const listing of active) {
    // Same rule as syncPendingListings: archiving ends the relationship;
    // drafts/hidden with a managed listing must keep reconciling.
    if (listing.product.status === 'archived') continue
    const central = listing.product.stockCount
    if (listing.lastSyncedQty !== central) {
      await prisma.ebayListing.update({
        where: { id: listing.id },
        data: { status: 'sync-pending', lastError: `reconciliation: central=${central} lastSynced=${listing.lastSyncedQty ?? 'never'}` },
      })
      drifted++
    }
  }
  if (drifted > 0) log.info({ drifted }, 'Reconciliation found eBay quantity drift — re-enqueued')
  return drifted
}

/** Job 4: reprocess webhook events that deferred on temporary failures. */
export async function retryDeferredEvents(): Promise<number> {
  if (!isEbayConfigured()) return 0
  const { retryPendingEvents } = await import('./ebayOrderService.js')
  return retryPendingEvents()
}

let interval: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null
let running = false
let kickRequested = false

/**
 * The sweeps. `includeOrders=false` (kick path) skips the order poll and the
 * deferred-event retry: webhooks already delivered those events and the
 * processor handles them inline — the poll is the gap-filler, not the
 * trigger, and kicks only need the quantity push.
 */
async function runSweeps(includeOrders: boolean): Promise<void> {
  if (includeOrders) {
    // A failed poll must not abort the quantity jobs.
    await pollRecentOrders().catch((err) => log.error({ err }, 'eBay order poll failed'))
  }
  await syncPendingListings()
  await reconcileEbayQuantities()
  if (includeOrders) await retryDeferredEvents()
}

async function tick() {
  if (running) return // never overlap sweeps
  running = true
  try {
    await runSweeps(true)
  } catch (err) {
    log.error({ err }, 'eBay sync tick failed')
  } finally {
    running = false
  }
}

/**
 * Event-driven push, requested by centralInventory (enqueueEbayQuantitySync)
 * after every central stock change: run one push pass immediately instead of
 * letting the change wait for the next 10-minute sweep. Sweeps-never-overlap
 * still holds: a kick landing mid-sweep folds into ONE debounced follow-up
 * run, so a burst of stock changes produces one extra pass, not one per
 * product. Failure simply falls back to the timed sweep.
 */
export function requestSyncTick(): void {
  if (running) { kickRequested = true; return }
  void kick().catch((err) => log.error({ err }, 'eBay sync kick failed'))
}

async function kick(): Promise<void> {
  if (running) { kickRequested = true; return }
  running = true
  try {
    await runSweeps(false)
  } catch (err) {
    log.error({ err }, 'eBay sync kick failed')
  } finally {
    running = false
    if (kickRequested) {
      kickRequested = false
      // The delay coalesces a whole burst of stock events into one pass.
      setTimeout(() => void kick().catch((err) => log.error({ err }, 'eBay sync kick failed')), 5_000)
    }
  }
}

export function startEbaySyncScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (interval) return
  firstRun = setTimeout(() => void tick(), FIRST_RUN_DELAY_MS)
  interval = setInterval(() => void tick(), intervalMs)
  log.info({ intervalMs }, 'eBay sync scheduler started')
}

export function stopEbaySyncScheduler() {
  if (firstRun) { clearTimeout(firstRun); firstRun = null }
  if (interval) { clearInterval(interval); interval = null }
}

/** Manual "sync now" for the admin view — runs one pass immediately. */
export async function syncNow() {
  let ordersPolled = 0
  try {
    ordersPolled = await pollRecentOrders()
  } catch (err) {
    log.error({ err }, 'eBay order poll failed (manual sync continues)')
  }
  const listings = await syncPendingListings()
  const drift = await reconcileEbayQuantities()
  return { ...listings, driftFound: drift, ordersPolled }
}
