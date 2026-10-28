/**
 * eBay catalog auto-sync (5-minute discovery sweep).
 *
 * Until now catalog imports ran only when an admin kicked them, so listings
 * created after the last manual import never reached the website — the known
 * eBay-store ↔ website count drift (e.g. 1,090 on eBay vs 1,074 on the site)
 * and it could only be closed by hand. This scheduler makes the catalog a
 * continuously-reconciled mirror:
 *
 *   1. Walk GetMyeBaySelling ActiveList across ALL pages (hardened walk:
 *      re-read totals per page, retry transient empty pages, never finish a
 *      walk silently short).
 *   2. Diff the walk against the ebay_listings mirror:
 *        a. Item IDs with no mirror row → enqueued into an incremental import
 *           job (createdBy = null marks system autosync jobs). The job runs on
 *           the 5-second import scheduler; with EBAY_AUTO_PUBLISH on, passing
 *           products publish themselves, satisfying "visible within 5
 *           minutes". Enqueues merge into one running autosync job instead of
 *           stacking jobs, and duplicates are impossible (dedupe by item id
 *           + SKU in the importer).
 *        b. Mirror rows missing from a COMPLETE walk → the listing ended
 *           (sold out / withdrawn / removed on eBay): mirror status 'ended'
 *           and, for products imported from eBay, availability flipped to
 *           out-of-stock. The product page stays live (SEO preserved) and
 *           this is reversible: a returning listing is re-activated by the
 *           next sweep. Never runs on an incomplete walk — a truncated walk
 *           must not false-flag live listings as ended.
 *   3. Import eBay price and stock changes for (and only for) eBay-imported
 *      products, keeping the site truthful when the seller reprices or
 *      re-quantities a listing on eBay. Sale windows are respected, and the
 *      quantity import is guarded by the mirror's lastSyncedQty so the
 *      website→eBay stock reconcile keeps ownership of locally-changed stock.
 *   4. Everything is logged (structured, greppable EBAY_AUTOSYNC marker) and
 *      audited per sweep, so a missing product can be diagnosed from the logs
 *      alone.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { logAudit } from '../utils/audit.js'
import { isEbayConfigured } from './ebayClient.js'
import { DEFAULT_IMPORT_MARKETPLACE, enqueueCatalogImport, processEbayImportJobs, walkActiveListings } from './ebayCatalogImportService.js'

const log = logger.child({ context: 'ebay-catalog-autosync' })

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const FIRST_RUN_DELAY_MS = 30 * 1000
const MIRROR_QUERY_CHUNK = 500
/** Defense-in-depth for end-detection: a real store rarely ends >5% in one
 *  sweep; anything larger is suspect (eBay outage, walk bug) and is skipped. */
const ENDED_PER_SWEEP_CAP = 200
/** Were these rows created ("Imported from eBay") — the scope where the sweep
 *  may flip availability/price to eBay's own values. Admin-authored catalog
 *  rows stay under warehouse control. */
const IMPORTED_FROM_EBAY = 'Imported from eBay'

export interface AutosyncSweepSummary {
  sweptAt: string
  marketplace: string
  durationMs: number
  walkComplete: boolean
  activeOnEbay: number
  eligibleItemIds: number
  skippedOtherMarketplace: number
  newlyListed: number
  importEnqueued: { jobId: string | null; added: number; merged: boolean } | null
  ended: number
  endedSkipped: number
  reactivated: number
  priceUpdates: number
  stockUpdates: number
  error: string | null
}

let lastSummary: AutosyncSweepSummary | null = null

/** Last sweep result, surfaced on the admin eBay route for diagnosis. */
export function getLastAutoSyncSummary(): AutosyncSweepSummary | null {
  return lastSummary
}

/**
 * One full reconciliation sweep. Safe to run from a fixed-interval scheduler
 * and from the admin "run now" route (sweeps never overlap).
 */
export async function sweepEbayCatalogAutoSync(options: { marketplace?: string } = {}): Promise<AutosyncSweepSummary> {
  const startedAt = Date.now()
  const marketplace = String(options.marketplace || DEFAULT_IMPORT_MARKETPLACE).toUpperCase()
  const summary: AutosyncSweepSummary = {
    sweptAt: new Date().toISOString(),
    marketplace,
    durationMs: 0,
    walkComplete: false,
    activeOnEbay: 0,
    eligibleItemIds: 0,
    skippedOtherMarketplace: 0,
    newlyListed: 0,
    importEnqueued: null,
    ended: 0,
    endedSkipped: 0,
    reactivated: 0,
    priceUpdates: 0,
    stockUpdates: 0,
    error: null,
  }

  if (!isEbayConfigured()) {
    summary.error = 'eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'
    log.warn(summary, 'EBAY_AUTOSYNC sweep skipped — eBay not configured')
    lastSummary = summary
    return summary
  }

  try {
    const walk = await walkActiveListings(marketplace)
    summary.activeOnEbay = walk.totalEntries
    summary.eligibleItemIds = walk.itemIds.length
    summary.skippedOtherMarketplace = walk.skippedOtherMarketplace
    summary.walkComplete = walk.complete

    // ── Mirror snapshot (chunked) ────────────────────────────────
    const activeIdSet = new Set(walk.itemIds)
    type MirrorRow = {
      id: string
      sku: string
      status: string
      ebayListingId: string | null
      lastSyncedQty: number | null
      product: {
        id: string
        sku: string
        status: string
        availability: string
        regularPrice: unknown
        salePrice: unknown
        saleStartsAt: Date | null
        saleEndsAt: Date | null
        stockCount: number
        internalNotes: string | null
      }
    }
    const mirrorRows = new Map<string, MirrorRow>() // by ebayListingId
    for (let offset = 0; offset < walk.itemIds.length; offset += MIRROR_QUERY_CHUNK) {
      const chunk = walk.itemIds.slice(offset, offset + MIRROR_QUERY_CHUNK)
      if (chunk.length === 0) continue
      const rows = await prisma.ebayListing.findMany({
        where: { marketplace, ebayListingId: { in: chunk } },
        select: {
          id: true,
          sku: true,
          status: true,
          ebayListingId: true,
          lastSyncedQty: true,
          product: {
            select: {
              id: true,
              sku: true,
              status: true,
              availability: true,
              regularPrice: true,
              salePrice: true,
              saleStartsAt: true,
              saleEndsAt: true,
              stockCount: true,
              internalNotes: true,
            },
          },
        },
      })
      for (const row of rows) {
        if (row.ebayListingId) mirrorRows.set(row.ebayListingId, row as MirrorRow)
      }
    }

    // ── a. newly listed on eBay → import (and auto-publish) ─────
    const newIds = walk.itemIds.filter((id) => !mirrorRows.has(id))
    summary.newlyListed = newIds.length
    if (newIds.length > 0) {
      const enqueue = await enqueueCatalogImport(newIds, marketplace)
      summary.importEnqueued = { jobId: enqueue.job.id, added: enqueue.added, merged: enqueue.merged }
      log.info(
        { jobId: enqueue.job.id, added: enqueue.added, merged: enqueue.merged, eligible: walk.itemIds.length },
        'EBAY_AUTOSYNC sweep found newly listed eBay items — incremental import job enqueued',
      )
      // Kick the import scheduler so import starts this second, not the next
      // tick — new products are then published within seconds-to-minutes.
      void processEbayImportJobs().catch((err) => log.error({ err }, 'EBAY_AUTOSYNC import kick failed'))
    }

    // ── b. ended / removed listings (complete walks only) ───────
    if (walk.complete) {
      const actions = {
        ended: 0,
        reactivated: 0,
      }
      for (const [listingId, row] of mirrorRows) {
        const isPresent = activeIdSet.has(listingId)
        if (!isPresent && row.status !== 'ended') {
          actions.ended += 1
        } else if (isPresent && row.status === 'ended') {
          actions.reactivated += 1
        }
      }
      if (actions.ended > ENDED_PER_SWEEP_CAP) {
        summary.endedSkipped = actions.ended
        log.warn(
          { endedCandidateCount: actions.ended, cap: ENDED_PER_SWEEP_CAP, marketplace },
          'EBAY_AUTOSYNC sweep deferred end-detection — implausibly many listings vanished in one sweep',
        )
      } else if (actions.ended > 0 || actions.reactivated > 0) {
        for (const [listingId, row] of mirrorRows) {
          const isPresent = activeIdSet.has(listingId)
          if (!isPresent && row.status !== 'ended') {
            await prisma.ebayListing.update({
              where: { id: row.id },
              data: {
                status: 'ended',
                lastError: `eBay listing no longer active (ended/removed): ActiveList sweep ${summary.sweptAt}`,
              },
            })
            // Only products THIS catalog imported flip to out-of-stock —
            // eBay-linked rows in an admin-managed catalog keep their
            // warehouse-controlled availability.
            const imported = Boolean(row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY))
            if (imported && row.product.status !== 'archived' && row.product.availability !== 'out-of-stock') {
              await prisma.product.update({
                where: { id: row.product.id },
                data: { availability: 'out-of-stock' },
              })
              log.warn({ sku: row.sku, productId: row.product.id, itemId: listingId }, 'EBAY_AUTOSYNC listing ended — eBay-imported product marked out-of-stock')
            } else {
              log.info({ sku: row.sku, productId: row.product.id, itemId: listingId, imported }, 'EBAY_AUTOSYNC listing ended')
            }
            summary.ended += 1
          } else if (isPresent && row.status === 'ended') {
            // The seller re-listed it. Restore the mirror and let the normal
            // stock reconcile push central quantity back to eBay.
            await prisma.ebayListing.update({
              where: { id: row.id },
              data: { status: 'synced', lastSyncedQty: null, lastError: null },
            })
            const imported = Boolean(row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY))
            if (imported && row.product.status === 'published') {
              const stockRows = await prisma.product.findUnique({ where: { id: row.product.id }, select: { stockCount: true } })
              const stockCount = stockRows?.stockCount ?? 0
              await prisma.product.update({
                where: { id: row.product.id },
                data: { availability: stockCount > 0 ? 'in-stock' : 'out-of-stock' },
              })
              log.info({ sku: row.sku, productId: row.product.id, itemId: listingId, stockCount }, 'EBAY_AUTOSYNC listing re-activated on eBay — product availability restored')
            }
            summary.reactivated += 1
          }
        }
      }
    }

    // ── c. keep imported prices and stock true to eBay (outside sale windows) ──
    if (walk.complete) {
      const now = new Date()
      for (const [listingId, row] of mirrorRows) {
        if (row.status === 'ended' || !activeIdSet.has(listingId)) continue
        if (!row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY)) continue
        if (row.product.status === 'archived') continue
        const listing = walk.listingsById.get(listingId)

        // Quantity: when eBay itself moved since the last recorded sync
        // (listing quantity ≠ the mirror's lastSyncedQty), the eBay value is
        // the product's truth — import stock + availability. The guard keeps
        // ownership boundaries: if the website's central stock changed without
        // eBay moving (an order or admin edit), the website→eBay reconcile
        // push owns that drift and this import must not overwrite it.
        if (listing && row.status === 'synced') {
          const ebayQty = Math.max(0, Math.floor(listing.quantity || 0))
          const lastKnown = row.lastSyncedQty
          if (ebayQty !== lastKnown && ebayQty !== row.product.stockCount) {
            await prisma.product.update({
              where: { id: row.product.id },
              data: {
                stockCount: ebayQty,
                availability: ebayQty > 0 ? 'in-stock' : 'out-of-stock',
              },
            })
            await prisma.ebayListing.update({
              where: { id: row.id },
              data: { lastSyncedQty: ebayQty, lastSyncAt: new Date(), status: 'synced' },
            })
            summary.stockUpdates += 1
            log.info(
              { sku: row.sku, productId: row.product.id, itemId: listingId, from: row.product.stockCount, to: ebayQty },
              'EBAY_AUTOSYNC stock imported from eBay listing (eBay quantity changed)',
            )
          }
        }

        // Price: sale windows are the site's own pricing decisions and stay
        // untouched; otherwise regularPrice tracks the live eBay price.
        const ebayPrice = listing?.price
        if (ebayPrice != null && Number.isFinite(ebayPrice)) {
          const onSaleWindow =
            row.product.salePrice != null &&
            (row.product.saleStartsAt == null || row.product.saleStartsAt <= now) &&
            (row.product.saleEndsAt == null || row.product.saleEndsAt >= now)
          if (!onSaleWindow) {
            const regularPrice = Number(row.product.regularPrice) || 0
            if (Math.abs(ebayPrice - regularPrice) >= 0.01) {
              await prisma.product.update({
                where: { id: row.product.id },
                data: { regularPrice: ebayPrice },
              })
              summary.priceUpdates += 1
              log.info({ sku: row.sku, productId: row.product.id, itemId: listingId, from: regularPrice, to: ebayPrice }, 'EBAY_AUTOSYNC price imported from eBay listing')
            }
          }
        }
      }
    }
  } catch (err) {
    summary.error = (err as Error).message.slice(0, 500)
    // A failed sweep must never silently leave the catalog stale: every miss
    // is greppable (EBAY_AUTOSYNC) and shows in the admin status route.
    log.error({ err, summary }, 'EBAY_AUTOSYNC sweep failed — catalog stays unchanged until the next sweep')
  }

  summary.durationMs = Date.now() - startedAt
  log.info(summary, 'EBAY_AUTOSYNC sweep summary')
  lastSummary = summary

  if (summary.newlyListed > 0 || summary.ended > 0 || summary.reactivated > 0 || summary.priceUpdates > 0 || summary.stockUpdates > 0 || summary.error) {
    await logAudit({
      action: 'catalog.autosync',
      entityType: 'ebay_autosync',
      entityName: `sweep ${summary.sweptAt}`,
      newValue: summary,
    })
  }

  return summary
}

// ─── Scheduler ─────────────────────────────────────────────────

function intervalMs(): number {
  const parsed = Number(process.env.EBAY_AUTOSYNC_INTERVAL_MS)
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS
  return Math.max(60_000, Math.floor(parsed))
}

let interval: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null
let running = false

export async function runAutoSyncTick(): Promise<AutosyncSweepSummary | null> {
  if (running) return null
  running = true
  try {
    return await sweepEbayCatalogAutoSync()
  } finally {
    running = false
  }
}

export function startEbayCatalogAutoSync(ms?: number) {
  if (interval) return
  firstRun = setTimeout(() => { void runAutoSyncTick() }, FIRST_RUN_DELAY_MS)
  interval = setInterval(() => { void runAutoSyncTick() }, ms ?? intervalMs())
  log.info({ intervalMs: ms ?? intervalMs() }, 'EBAY_AUTOSYNC scheduler started (every 5 min by default)')
}

export function stopEbayCatalogAutoSync() {
  if (firstRun) { clearTimeout(firstRun); firstRun = null }
  if (interval) { clearInterval(interval); interval = null }
}
