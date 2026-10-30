/**
 * eBay sync scheduler (roadmap C — eventual consistency).
 *
 * Follows the fixed-setInterval pattern of offerExpiryScheduler (no cron lib).
 *
 * The quantity rules themselves live in ebaySyncPipeline.ts, which receives
 * its storage and eBay clients as dependencies so the pipeline can be tested
 * with a mocked Prisma client and Trading API. This module only wires the real
 * Prisma client and API clients into that pipeline, then schedules it.
 *
 * Four timed safety jobs:
 *   1. pollRecentOrders — webhook-delivery net: recent Fulfillment orders run
 *      through the same idempotent processor. Order-level dedupe keeps stock
 *      claims single; failed orders retry on the next tick bucket.
 *   2. syncPendingListings — pushes CENTRAL stock to every eBay listing marked
 *      sync-pending, using the Inventory API offer id when present or the
 *      Trading API ItemID for imported listings (admin-paused rows are
 *      skipped). Central inventory is authoritative: failures never roll stock
 *      back, only mark the mirror unhealthy.
 *   3. reconcileEbayQuantities — detects drift between central stock and the
 *      last synced quantity (e.g. a missed webhook) and re-enqueues
 *      (admin-paused rows never re-enqueue).
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
import {
  PUSH_BATCH_SIZE,
  pushListingNow as pipelinePushListingNow,
  reconcileQuantities,
  syncPendingQuantities,
  type EbayListingSnapshot,
  type EbaySyncPipelineDeps,
  type EbaySyncStore,
} from './ebaySyncPipeline.js'

const log = logger.child({ context: 'ebay-sync' })

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000
const FIRST_RUN_DELAY_MS = 90 * 1000

/** Real Prisma-backed storage for the quantity pipeline. */
const store: EbaySyncStore = {
  pendingListings: (limit) =>
    prisma.ebayListing.findMany({
      // Admin-paused rows (eBay Hub) leave the website→eBay direction entirely:
      // they are never pushed here and never re-enqueued by the reconciler.
      where: { status: 'sync-pending', syncDisabled: false },
      include: { product: { select: { stockCount: true, status: true, sku: true } } },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    }) as Promise<EbayListingSnapshot[]>,

  activeListings: () =>
    prisma.ebayListing.findMany({
      where: { status: { in: ['synced', 'published', 'sync-failed'] }, syncDisabled: false },
      include: { product: { select: { stockCount: true, status: true, sku: true } } },
      // The whole mapped catalog is checked; 8k rows is small enough for an
      // in-memory compare, and drift rows are the only ones written back.
      orderBy: { updatedAt: 'asc' },
    }) as Promise<EbayListingSnapshot[]>,

  listing: (id) =>
    prisma.ebayListing.findUnique({
      where: { id },
      include: { product: { select: { stockCount: true, status: true, sku: true } } },
    }) as Promise<EbayListingSnapshot | null>,

  updateListing: async (id, data) => {
    await prisma.ebayListing.update({ where: { id }, data })
  },
}

function pipelineDeps(): EbaySyncPipelineDeps {
  return {
    store,
    apis: { setOfferQuantity: updateOfferQuantity, reviseTradingQuantity },
    isRetryable: isRetryableError,
    log: (level, data, message) => log[level](data, message),
  }
}

/** Job 1: pull recent orders (webhook-delivery net). */
export async function pollRecentOrders(): Promise<number> {
  if (!isEbayConfigured()) return 0
  const { pollEbayOrders } = await import('./ebayOrderService.js')
  return pollEbayOrders()
}

/** Force one order-gap poll after a process restart when no webhook has arrived. */
export function noteEbayOrderWebhook(): void {
  lastOrderPollAt = Date.now()
}

/** Job 2: push central stock to eBay for all pending listings. */
export async function syncPendingListings(): Promise<{ synced: number; failed: number; skipped: number }> {
  if (!isEbayConfigured()) {
    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.02) {
      log.info('eBay not configured — sync sweep idle')
    }
    return { synced: 0, failed: 0, skipped: 0 }
  }
  return syncPendingQuantities(pipelineDeps(), { batchSize: PUSH_BATCH_SIZE })
}

/** Back-compat shape for callers that typed their rows against the scheduler. */
export type PushableListing = EbayListingSnapshot

/**
 * eBay Hub action: push ONE listing's central quantity to eBay immediately
 * (instead of waiting for the next sweep/kick).
 */
export async function pushListingNow(listingId: string): Promise<{ ok: boolean; message: string }> {
  return pipelinePushListingNow(pipelineDeps(), listingId)
}

/** Job 3: detect drift between central stock and the last pushed quantity. */
export async function reconcileEbayQuantities(): Promise<number> {
  if (!isEbayConfigured()) return 0
  const drifted = await reconcileQuantities(pipelineDeps())
  if (drifted > 0) log.info({ drifted }, 'Reconciliation found eBay quantity drift — re-enqueued')
  return drifted
}

/** Job 4: reprocess webhook events that deferred on temporary failures. */
export async function retryDeferredEvents(): Promise<number> {
  if (!isEbayConfigured()) return 0
  const { retryPendingEvents } = await import('./ebayOrderService.js')
  return retryPendingEvents()
}

let lastOrderPollAt = 0
let orderPollInFlight = false
const ORDER_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000
const ORDER_POLL_STALE_MS = 24 * 60 * 60 * 1000

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
  await syncPendingListings()
  await reconcileEbayQuantities()
  if (includeOrders) await retryDeferredEvents()
}

/** Event webhook heartbeat suppresses routine Fulfillment API polling. */
async function pollOrdersIfNeeded(force = false): Promise<number> {
  if (!isEbayConfigured()) return 0
  const now = Date.now()
  if (!force && lastOrderPollAt && now - lastOrderPollAt < ORDER_POLL_INTERVAL_MS) return 0
  if (!force && lastOrderPollAt && now - lastOrderPollAt >= ORDER_POLL_STALE_MS) {
    log.warn({ hoursSincePoll: Math.floor((now - lastOrderPollAt) / 3_600_000) }, 'eBay order poll has gone stale; retrying despite the normal cadence')
  }
  if (orderPollInFlight) return 0
  // Mark before awaiting to avoid a concurrent admin/manual poll from
  // stacking another Fulfillment call while this scheduler tick is active.
  lastOrderPollAt = now
  orderPollInFlight = true
  try {
    const result = await pollRecentOrders()
    await retryDeferredEvents()
    return result
  } finally {
    orderPollInFlight = false
  }
}

async function tick() {
  if (running) return // never overlap sweeps
  running = true
  let pollOrders = false
  if (!lastOrderPollAt) {
    pollOrders = true
    lastOrderPollAt = Date.now()
  }
  try {
    await runSweeps(false)
    if (pollOrders) {
      await pollOrdersIfNeeded().catch((err) => log.error({ err }, 'eBay order safety poll failed'))
    }
  } catch (err) {
    log.error({ err }, 'eBay sync tick failed')
  } finally {
    running = false
    if (kickRequested) {
      kickRequested = false
      setTimeout(() => void kick().catch((err) => log.error({ err }, 'eBay sync kick failed')), 5_000)
    }
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

export function syncSafetyIntervalMs(): number {
  const parsed = Number(process.env.EBAY_SYNC_INTERVAL_MS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(60_000, Math.floor(parsed)) : DEFAULT_INTERVAL_MS
}

export function startEbaySyncScheduler(intervalMs = syncSafetyIntervalMs()) {
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
  const ordersPolled = await pollOrdersIfNeeded(true).catch((err) => {
    log.error({ err }, 'eBay order poll failed (manual sync continues)')
    return 0
  })
  const listings = await syncPendingListings()
  const drift = await reconcileEbayQuantities()
  return { ...listings, driftFound: drift, ordersPolled }
}
