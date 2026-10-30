/**
 * eBay catalog auto-sync (low-frequency reconciliation sweep).
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
 *   3. Import eBay price, stock AND condition changes for (and only for)
 *      eBay-imported products, keeping the site truthful when the seller
 *      reprices, re-quantities or re-states a listing's condition on eBay.
 *      Sale windows are respected, the quantity import is guarded by the
 *      mirror's lastSyncedQty so the website→eBay stock reconcile keeps
 *      ownership of locally-changed stock, and the condition comes from the
 *      walk when eBay reports it — otherwise a bounded GetItem budget
 *      (rotating window per sweep) verifies rows.
 *
 *      EBAY_FULL_MIRROR=1 dissolves the ownership boundary: every walked row
 *      — including admin-authored products linked by SKU — follows eBay for
 *      price (the site's own stale sale window is cleared), condition, stock
 *      and the whole content surface (photos, title, description, item
 *      specifics) through the same rotating GetItem window. The storefront
 *      becomes a live mirror of the seller's listings.
 *   4. Everything is logged (structured, greppable EBAY_AUTOSYNC marker) and
 *      audited per sweep, so a missing product can be diagnosed from the logs
 *      alone.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { logAudit } from '../utils/audit.js'
import { isEbayConfigured } from './ebayClient.js'
import { DEFAULT_IMPORT_MARKETPLACE, enqueueCatalogImport, walkActiveListings } from './ebayCatalogImportService.js'
import { getEbayItemDetails } from './ebayTradingService.js'
import { planConditionUpdate } from './ebayCatalogMapping.js'
import { syncFullEbayProduct } from './ebayCatalogImportService.js'
import { deepSyncBudget, mirrorModeEnabled } from './ebayMirror.js'

const log = logger.child({ context: 'ebay-catalog-autosync' })

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000
const MIRROR_QUERY_CHUNK = 500
/** Defense-in-depth for end-detection: a real store rarely ends >5% in one
 *  sweep; anything larger is suspect (eBay outage, walk bug) and is skipped. */
const ENDED_PER_SWEEP_CAP = 200
/** The sweep's default ownership scope: rows whose internalNotes start with
 *  this were created by an eBay import. In mirror mode (EBAY_FULL_MIRROR=1)
 *  every walked row joins the scope instead; the rotating GetItem deep pass
 *  uses a daily-quota-bounded budget (EBAY_MIRROR_GETITEM_BUDGET). */
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
  conditionUpdates: number
  conditionChecked: number
  /** Mirror mode only: photos added/removed and content+spec updates. */
  imageSyncs: number
  contentSyncs: number
  error: string | null
}

let lastSummary: AutosyncSweepSummary | null = null

/** Rotating GetItem verification window across sweeps (see section d). */
let conditionRefreshCursor = 0

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
    conditionUpdates: 0,
    conditionChecked: 0,
    imageSyncs: 0,
    contentSyncs: 0,
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
    /** Mirror mode: eBay owns price/condition/content/ended-state for every
     *  walked row, not just the ones this catalog originally imported. */
    const mirrorAll = mirrorModeEnabled()

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
        condition: string
        conditionNotes: string | null
        internalNotes: string | null
        /** Mirror-mode deep sync: the fields a listing revision may overwrite. */
        name: string
        description: string | null
        shortDescription: string | null
        keyFeatures: string[]
        includedItems: string[]
        manufacturer: string | null
        modelNumber: string | null
        mpn: string | null
      }
    }
    // Every mirror row for this marketplace, not just the ids seen in this
    // walk: end-detection below compares the walk against these rows, so
    // loading only walked ids made "absent from the walk" impossible and
    // silently disabled ended-listing detection.
    const mirrorRows = new Map<string, MirrorRow>() // by ebayListingId
    for (let offset = 0; ; offset += MIRROR_QUERY_CHUNK) {
      const rows = await prisma.ebayListing.findMany({
        where: { marketplace },
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
              condition: true,
              conditionNotes: true,
              internalNotes: true,
              name: true,
              description: true,
              shortDescription: true,
              keyFeatures: true,
              includedItems: true,
              manufacturer: true,
              modelNumber: true,
              mpn: true,
            },
          },
        },
        orderBy: { id: 'asc' },
        skip: offset,
        take: MIRROR_QUERY_CHUNK,
      })
      for (const row of rows) {
        if (row.ebayListingId) mirrorRows.set(row.ebayListingId, row as MirrorRow)
      }
      if (rows.length < MIRROR_QUERY_CHUNK) break
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
            // Mirror mode listens to eBay for every row; otherwise only
            // products THIS catalog imported flip out-of-stock — eBay-linked
            // rows in an admin-managed catalog keep their warehouse control.
            const imported = mirrorAll || Boolean(row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY))
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
            const imported = mirrorAll || Boolean(row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY))
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

    // ── c. keep imported prices, stock and condition true to eBay ──
    if (walk.complete) {
      const now = new Date()
      // Mirror mode deep-verifies EVERY walked row (photos, content, spec and
      // condition drift all surface through GetItem); otherwise only rows
      // whose ActiveList walk carried no condition are verified through the
      // budgeted rotating window (see section d) so every row still converges
      // without one draw costing 1,000+ calls.
      const deepTargets: Array<{ listingId: string; row: MirrorRow }> = []
      for (const [listingId, row] of mirrorRows) {
        if (row.status === 'ended' || !activeIdSet.has(listingId)) continue
        if (!mirrorAll && !row.product.internalNotes?.startsWith(IMPORTED_FROM_EBAY)) continue
        if (row.product.status === 'archived') continue
        const listing = walk.listingsById.get(listingId)

        if (listing?.condition) {
          summary.conditionChecked += 1
          const plan = planConditionUpdate(row.product, listing.condition)
          if (plan) {
            await prisma.product.update({
              where: { id: row.product.id },
              data: { condition: plan.condition, conditionNotes: plan.conditionNotes },
            })
            summary.conditionUpdates += 1
            log.info(
              { sku: row.sku, productId: row.product.id, itemId: listingId, from: row.product.condition, to: plan.condition, eBay: listing.condition },
              'EBAY_AUTOSYNC condition imported from eBay listing',
            )
          }
        }
        if (mirrorAll || !listing?.condition) {
          deepTargets.push({ listingId, row })
        }

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

        // Price: a site-side sale window wins by default — sale windows are
        // the site's own pricing decisions. In mirror mode eBay wins instead:
        // the live listing price overwrites regularPrice and any stale site
        // sale window is cleared so the displayed price matches eBay exactly.
        const ebayPrice = listing?.price
        if (ebayPrice != null && Number.isFinite(ebayPrice)) {
          const onSaleWindow =
            row.product.salePrice != null &&
            (row.product.saleStartsAt == null || row.product.saleStartsAt <= now) &&
            (row.product.saleEndsAt == null || row.product.saleEndsAt >= now)
          if (!onSaleWindow || mirrorAll) {
            const regularPrice = Number(row.product.regularPrice) || 0
            const priceChanged = Math.abs(ebayPrice - regularPrice) >= 0.01
            const staleSaleWindow = mirrorAll && row.product.salePrice != null
            if (priceChanged || staleSaleWindow) {
              const data: Record<string, unknown> = { regularPrice: ebayPrice }
              if (mirrorAll && staleSaleWindow) {
                data.salePrice = null
                data.saleStartsAt = null
                data.saleEndsAt = null
              }
              await prisma.product.update({
                where: { id: row.product.id },
                data,
              })
              summary.priceUpdates += 1
              log.info(
                {
                  sku: row.sku,
                  productId: row.product.id,
                  itemId: listingId,
                  from: regularPrice,
                  to: ebayPrice,
                  saleCleared: staleSaleWindow || undefined,
                },
                mirrorAll
                  ? 'EBAY_AUTOSYNC price mirrored from eBay listing'
                  : 'EBAY_AUTOSYNC price imported from eBay listing',
              )
            }
          }
        }
      }

      // ── d. deep verification via GetItem (rotating bounded window) ──
      // Sweep N verifies rows [cursor, cursor+budget) so the whole catalog
      // re-verifies without ever one-sweeping all 1,089 items in one draw.
      // Mirror mode: each verified row also gets its full content pass
      // (photos, title, description, item specifics) — a listing revised on
      // eBay becomes site-true within one rotation of the window.
      if (deepTargets.length > 0) {
        const budget = Math.min(deepSyncBudget(), deepTargets.length)
        const sorted = deepTargets.slice().sort((a, b) => a.listingId.localeCompare(b.listingId))
        const start = conditionRefreshCursor % sorted.length
        const targets: Array<{ listingId: string; row: MirrorRow }> = []
        for (let i = 0; i < budget; i += 1) {
          targets.push(sorted[(start + i) % sorted.length])
        }
        conditionRefreshCursor = (conditionRefreshCursor + budget) % Math.max(1, sorted.length)
        summary.conditionChecked += targets.length
        for (const { listingId, row } of targets) {
          try {
            const details = await getEbayItemDetails(listingId)
            const plan = planConditionUpdate(row.product, details.condition)
            if (plan) {
              await prisma.product.update({
                where: { id: row.product.id },
                data: { condition: plan.condition, conditionNotes: plan.conditionNotes },
              })
              summary.conditionUpdates += 1
              log.info(
                { sku: row.sku, productId: row.product.id, itemId: listingId, from: row.product.condition, to: plan.condition, eBay: details.condition },
                'EBAY_AUTOSYNC condition imported from eBay GetItem',
              )
            }
            if (mirrorAll) {
              const resync = await syncFullEbayProduct({
                product: {
                  id: row.product.id,
                  sku: row.product.sku,
                  name: row.product.name,
                  description: row.product.description,
                  shortDescription: row.product.shortDescription,
                  keyFeatures: row.product.keyFeatures,
                  includedItems: row.product.includedItems,
                  manufacturer: row.product.manufacturer,
                  modelNumber: row.product.modelNumber,
                  mpn: row.product.mpn,
                },
                details,
              })
              summary.imageSyncs += resync.imagesAdded + resync.imagesRemoved
              if (resync.contentUpdated || resync.specsUpdated) summary.contentSyncs += 1
              if (resync.changed) {
                log.info(
                  {
                    sku: row.sku,
                    productId: row.product.id,
                    itemId: listingId,
                    contentUpdated: resync.contentUpdated,
                    specsUpdated: resync.specsUpdated,
                    imagesAdded: resync.imagesAdded,
                    imagesRemoved: resync.imagesRemoved,
                  },
                  'EBAY_AUTOSYNC listing content mirrored from eBay GetItem',
                )
              }
            }
          } catch (err) {
            log.warn({ err: (err as Error).message, itemId: listingId, sku: row.sku }, 'EBAY_AUTOSYNC deep GetItem refresh failed — retried next sweep')
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

  if (
    summary.newlyListed > 0 ||
    summary.ended > 0 ||
    summary.reactivated > 0 ||
    summary.priceUpdates > 0 ||
    summary.stockUpdates > 0 ||
    summary.conditionUpdates > 0 ||
    summary.error
  ) {
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

export function autoSyncIntervalMs(): number {
  const parsed = Number(process.env.EBAY_AUTOSYNC_INTERVAL_MS)
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS
  // Keep the full ActiveList walk inside a daily Trading API budget.
  return Math.max(300_000, Math.floor(parsed))
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
  const cadence = ms ?? autoSyncIntervalMs()
  interval = setInterval(() => { void runAutoSyncTick() }, cadence)
  log.info({ intervalMs: cadence }, 'EBAY_AUTOSYNC reconciliation scheduler started (every 6 hours by default)')
}

export function stopEbayCatalogAutoSync() {
  if (firstRun) { clearTimeout(firstRun); firstRun = null }
  if (interval) { clearInterval(interval); interval = null }
}
