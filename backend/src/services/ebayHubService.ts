/**
 * eBay Hub — the admin control surface for the whole eBay ↔ website channel.
 *
 * Everything the sweep/import/webhook code does automatically can be inspected
 * here, and the repair actions an admin needs when automation got something
 * wrong (paused mirror row, stale copy, drifted quantity, failed order, failed
 * webhook) are exposed as explicit, audited operations.
 *
 * Scope of the write actions is deliberately conservative (see the route file):
 *   - pause/resume the website→eBay direction for ONE listing
 *   - push that listing's central quantity now
 *   - re-sync ONE listing's content, item specifics, condition and photos
 *   - import ONE active eBay listing that discovery/import missed
 *   - retry ONE failed eBay order or notification
 *   - flip the runtime behaviour flags (mirror mode, auto-publish) and the
 *     category pins
 * Nothing here ends a live listing on eBay or edits eBay price/title.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { logAudit } from '../utils/audit.js'
import type { AuthUser } from '../middleware/auth.js'
import { isEbayConfigured } from './ebayClient.js'
import { getActiveEbayListings, getEbayItemDetails } from './ebayTradingService.js'
import { planConditionUpdate, resolveCategoryId } from './ebayCatalogMapping.js'
import {
  autoPublishEnabled,
  autoPublishSource,
  getLatestEbayCatalogImport,
  syncFullEbayProduct,
  type PublicEbayImportJob,
} from './ebayCatalogImportService.js'
import { deepSyncBudget, maxImportImages, mirrorModeEnabled, mirrorModeSource } from './ebayMirror.js'
import { autoSyncIntervalMs, getLastAutoSyncSummary, type AutosyncSweepSummary } from './ebayCatalogAutoSync.js'
import { getImageBackfillJob, type PublicImageBackfillJob } from './ebayImageBackfill.js'
import { pushListingNow, syncSafetyIntervalMs } from './ebaySyncScheduler.js'
import { processEbayOrderEvent, type ProcessEventResult } from './ebayOrderService.js'
import {
  getEbayRuntimeFlag,
  setEbayCategoryPins,
  setEbayRuntimeFlag,
} from './ebayAdminRuntime.js'
import { activeCategoryPins, adminCategoryPinCount } from './ebayCategoryMapping.js'

const log = logger.child({ context: 'ebay-hub' })

/** HTTP-shaped error the route layer can translate into a status code. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

function money(value: unknown): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function countFrom(groups: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
  return Object.fromEntries(groups.map((row) => [row.status, row._count._all]))
}

function envBool(name: string): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback
}

// ─── Overview / diagnostics ────────────────────────────────────

export interface EbayHubOverview {
  connection: {
    configured: boolean
    environment: string
    siteId: string | null
    accountConfigComplete: boolean
    missingAccountConfig: string[]
  }
  flags: {
    fullMirror: { override: boolean | null; source: 'admin' | 'env'; effective: boolean; envDefault: boolean }
    autoPublish: { override: boolean | null; source: 'admin' | 'env'; effective: boolean; envDefault: boolean }
    categoryPinCount: number
  }
  listings: {
    mapped: number
    byStatus: Record<string, number>
    paused: number
    syncFailed: number
    endedButInStock: number
    quantityDrift: number
    mappedProductsWithoutImages: number
    draftProductsLiveOnEbay: number
  }
  catalog: {
    products: number
    importedFromEbay: number
  }
  orders: {
    byStatus: Record<string, number>
    failed: number
    ignored: number
  }
  events: {
    byStatus: Record<string, number>
  }
  lastSweep: AutosyncSweepSummary | null
  lastImportJob: PublicEbayImportJob | null
  lastImageBackfill: PublicImageBackfillJob | null
  schedules: {
    autosyncIntervalMs: number
    syncIntervalMs: number
    importBatchSize: number
    imageBackfillBatch: number
    imageBackfillTickMs: number
    mirrorDeepBudget: number
  }
  problems: {
    syncFailedListings: Array<{ id: string; sku: string; marketplace: string; status: string; lastError: string | null; updatedAt: string; product: { id: string; name: string } | null }>
    failedOrders: Array<{ ebayOrderId: string; status: string; lastError: string | null; updatedAt: string; orderNumber: string | null }>
    failedEvents: Array<{ eventId: string; topic: string; error: string | null; createdAt: string }>
  }
}

export async function getEbayHubOverview(): Promise<EbayHubOverview> {
  const [
    listingStatusGroups,
    paused,
    mapped,
    syncFailed,
    endedButInStock,
    mappedProductsWithoutImages,
    draftProductsLiveOnEbay,
    productCount,
    importedCount,
    orderStatusGroups,
    eventStatusGroups,
    driftRows,
    lastImportJob,
    syncFailedListings,
    failedOrders,
    failedEvents,
  ] = await Promise.all([
    prisma.ebayListing.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ebayListing.count({ where: { syncDisabled: true } }),
    prisma.ebayListing.count(),
    prisma.ebayListing.count({ where: { status: 'sync-failed' } }),
    // A listing that ended on eBay while the website still says in-stock is a
    // real oversell risk — the sweep should have flipped availability.
    prisma.ebayListing.count({ where: { status: 'ended', product: { availability: { not: 'out-of-stock' } } } }),
    prisma.product.count({ where: { status: { not: 'archived' }, ebayListings: { some: {} }, images: { none: {} } } }),
    // Draft products still selling on eBay (imported rows stay drafts until the
    // publish gate clears). Ended listings are not "live", so exclude them.
    prisma.ebayListing.count({ where: { status: { not: 'ended' }, product: { status: 'draft' } } }),
    prisma.product.count({ where: { status: { not: 'archived' } } }),
    prisma.product.count({ where: { internalNotes: { startsWith: 'Imported from eBay' } } }),
    prisma.ebayOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ebayEventLog.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM ebay_listings l
      JOIN products p ON p.id = l.product_id
      WHERE l.last_synced_qty IS DISTINCT FROM p.stock_count
        AND l.sync_disabled = false
        AND l.status IN ('synced', 'published', 'pending', 'sync-failed')
    `,
    getLatestEbayCatalogImport(),
    prisma.ebayListing.findMany({
      where: { status: 'sync-failed' },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true, sku: true, marketplace: true, status: true, lastError: true, updatedAt: true,
        product: { select: { id: true, name: true } },
      },
    }),
    prisma.ebayOrder.findMany({
      where: { status: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        ebayOrderId: true, status: true, lastError: true, updatedAt: true,
        order: { select: { orderNumber: true } },
      },
    }),
    prisma.ebayEventLog.findMany({
      where: { status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { eventId: true, topic: true, error: true, createdAt: true },
    }),
  ])

  const orderStatus = countFrom(orderStatusGroups)
  const missingAccountConfig = [
    'EBAY_MERCHANT_LOCATION_KEY',
    'EBAY_FULFILLMENT_POLICY_ID',
    'EBAY_PAYMENT_POLICY_ID',
    'EBAY_RETURN_POLICY_ID',
  ].filter((key) => !process.env[key])

  return {
    connection: {
      configured: isEbayConfigured(),
      environment: (process.env.EBAY_ENV || 'sandbox').toLowerCase(),
      siteId: process.env.EBAY_SITE_ID || null,
      accountConfigComplete: missingAccountConfig.length === 0,
      missingAccountConfig,
    },
    flags: {
      fullMirror: {
        override: getEbayRuntimeFlag('fullMirror').override,
        source: mirrorModeSource(),
        effective: mirrorModeEnabled(),
        envDefault: envBool('EBAY_FULL_MIRROR'),
      },
      autoPublish: {
        override: getEbayRuntimeFlag('autoPublish').override,
        source: autoPublishSource(),
        effective: autoPublishEnabled(),
        envDefault: String(process.env.EBAY_AUTO_PUBLISH || '1').trim() !== '0',
      },
      categoryPinCount: activeCategoryPins().length,
    },
    listings: {
      mapped,
      byStatus: countFrom(listingStatusGroups),
      paused,
      syncFailed,
      endedButInStock,
      quantityDrift: driftRows[0]?.count ?? 0,
      mappedProductsWithoutImages,
      draftProductsLiveOnEbay,
    },
    catalog: { products: productCount, importedFromEbay: importedCount },
    orders: {
      byStatus: orderStatus,
      failed: orderStatus.failed ?? 0,
      ignored: orderStatus.ignored ?? 0,
    },
    events: { byStatus: countFrom(eventStatusGroups) },
    lastSweep: getLastAutoSyncSummary(),
    lastImportJob,
    lastImageBackfill: getImageBackfillJob(),
    schedules: {
      autosyncIntervalMs: autoSyncIntervalMs(),
      syncIntervalMs: syncSafetyIntervalMs(),
      importBatchSize: envInt('EBAY_IMPORT_BATCH_SIZE', 4),
      imageBackfillBatch: envInt('EBAY_IMAGE_BACKFILL_BATCH', 4),
      imageBackfillTickMs: envInt('EBAY_IMAGE_BACKFILL_TICK_MS', 60_000),
      mirrorDeepBudget: deepSyncBudget(),
    },
    problems: {
      syncFailedListings: syncFailedListings.map((row) => ({
        id: row.id,
        sku: row.sku,
        marketplace: row.marketplace,
        status: row.status,
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString(),
        product: row.product,
      })),
      failedOrders: failedOrders.map((row) => ({
        ebayOrderId: row.ebayOrderId,
        status: row.status,
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString(),
        orderNumber: row.order?.orderNumber ?? null,
      })),
      failedEvents: failedEvents.map((row) => ({
        eventId: row.eventId,
        topic: row.topic,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  }
}

// ─── Mirror listing rows ───────────────────────────────────────

export interface EbayHubListingsQuery {
  status?: string
  marketplace?: string
  paused?: string
  search?: string
  page?: number
  limit?: number
}

export async function listEbayHubListings(query: EbayHubListingsQuery) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))

  const where: Prisma.EbayListingWhereInput = {}
  if (query.status) where.status = query.status
  if (query.marketplace) where.marketplace = query.marketplace.toUpperCase()
  if (query.paused === 'true') where.syncDisabled = true
  if (query.paused === 'false') where.syncDisabled = false
  if (query.search?.trim()) {
    const search = query.search.trim()
    where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { ebayListingId: { contains: search } },
      { ebayOfferId: { contains: search } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [rows, total, statusGroups, marketplaces] = await Promise.all([
    prisma.ebayListing.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, sku: true, marketplace: true, status: true, syncDisabled: true,
        ebayOfferId: true, ebayListingId: true, lastSyncedQty: true, lastSyncAt: true,
        lastError: true, createdAt: true, updatedAt: true,
        product: {
          select: {
            id: true, name: true, slug: true, status: true, availability: true,
            stockCount: true, regularPrice: true, salePrice: true, currency: true,
            updatedAt: true,
            _count: { select: { images: true } },
          },
        },
      },
    }),
    prisma.ebayListing.count({ where }),
    prisma.ebayListing.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.ebayListing.groupBy({ by: ['marketplace'], _count: { _all: true } }),
  ])

  return {
    listings: rows.map((row) => ({
      id: row.id,
      sku: row.sku,
      marketplace: row.marketplace,
      status: row.status,
      syncDisabled: row.syncDisabled,
      ebayOfferId: row.ebayOfferId,
      ebayListingId: row.ebayListingId,
      lastSyncedQty: row.lastSyncedQty,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      product: {
        id: row.product.id,
        name: row.product.name,
        slug: row.product.slug,
        status: row.product.status,
        availability: row.product.availability,
        stockCount: row.product.stockCount,
        regularPrice: money(row.product.regularPrice),
        salePrice: money(row.product.salePrice),
        currency: row.product.currency,
        imageCount: row.product._count.images,
        updatedAt: row.product.updatedAt.toISOString(),
      },
      quantityDrift: row.lastSyncedQty !== row.product.stockCount,
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    statusCounts: countFrom(statusGroups),
    marketplaces: marketplaces.map((row) => ({ marketplace: row.marketplace, count: row._count._all })),
  }
}

// ─── Per-listing repairs ───────────────────────────────────────

/** Pause/resume the website→eBay direction for one mirror row. */
export async function setEbayListingPaused(listingId: string, disabled: boolean, actor: AuthUser) {
  const row = await prisma.ebayListing.findUnique({
    where: { id: listingId },
    select: { id: true, sku: true, marketplace: true, syncDisabled: true },
  })
  if (!row) throw httpError(404, 'eBay listing not found')

  const updated = await prisma.ebayListing.update({
    where: { id: listingId },
    data: { syncDisabled: disabled },
    select: { id: true, sku: true, marketplace: true, syncDisabled: true },
  })
  await logAudit({
    actor,
    action: disabled ? 'ebay.listing.pause' : 'ebay.listing.resume',
    entityType: 'ebay_listing',
    entityId: updated.id,
    entityName: `${updated.sku} (${updated.marketplace})`,
    previousValue: { syncDisabled: row.syncDisabled },
    newValue: { syncDisabled: updated.syncDisabled },
  })
  log.info({ listingId, sku: updated.sku, disabled, actor: actor.email }, 'eBay listing sync toggled')
  return updated
}

/** Push this listing's central quantity to eBay immediately. */
export async function pushEbayListingQuantity(listingId: string) {
  const result = await pushListingNow(listingId)
  if (!result.ok) throw httpError(409, result.message)
  return result
}

/** Re-sync one listing's content, item specifics, condition and photos. */
export async function resyncEbayListing(listingId: string, actor: AuthUser) {
  const row = await prisma.ebayListing.findUnique({
    where: { id: listingId },
    select: {
      id: true, sku: true, marketplace: true, ebayListingId: true,
      product: {
        select: {
          id: true, sku: true, name: true, description: true, shortDescription: true,
          keyFeatures: true, includedItems: true, manufacturer: true, modelNumber: true,
          mpn: true, condition: true, conditionNotes: true,
        },
      },
    },
  })
  if (!row) throw httpError(404, 'eBay listing not found')
  if (!row.ebayListingId) {
    throw httpError(400, 'This listing has no eBay item id (offer not published yet) — nothing to pull from eBay')
  }

  const details = await getEbayItemDetails(row.ebayListingId)
  if (details.marketplace && details.marketplace !== row.marketplace) {
    throw httpError(400, `eBay reports this item on ${details.marketplace}, but the mirror row is ${row.marketplace}`)
  }

  const result = await syncFullEbayProduct({
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

  // Condition is part of the listing truth and cheap to reconcile (the sweep
  // does it too; this makes a single-row repair complete).
  const conditionPlan = planConditionUpdate(
    { condition: row.product.condition, conditionNotes: row.product.conditionNotes },
    details.condition,
  )
  if (conditionPlan) {
    await prisma.product.update({ where: { id: row.product.id }, data: conditionPlan })
  }

  await logAudit({
    actor,
    action: 'ebay.listing.resync',
    entityType: 'ebay_listing',
    entityId: row.id,
    entityName: `${row.sku} (${row.marketplace})`,
    newValue: {
      itemId: row.ebayListingId,
      changed: result.changed,
      contentUpdated: result.contentUpdated,
      specsUpdated: result.specsUpdated,
      imagesAdded: result.imagesAdded,
      imagesRemoved: result.imagesRemoved,
      conditionUpdated: Boolean(conditionPlan),
    },
  })
  log.info({ listingId, sku: row.sku, itemId: row.ebayListingId, ...result }, 'eBay listing re-synced from eBay by admin')

  return {
    ...result,
    conditionUpdated: Boolean(conditionPlan),
    productId: row.product.id,
  }
}

/**
 * Re-run the website category rules for ONE listing and apply the result.
 *
 * New imports get the current mapping automatically, but products imported
 * before a pin/keyword fix keep their old category. This is the per-product
 * repair for exactly that: re-resolve from eBay's leaf category id + name +
 * title + item specifics (admin pins first, then aliases, keywords, fallback)
 * and write the category only when it differs. The trace goes to
 * internal_notes so the decision stays auditable on the product.
 */
export async function reapplyEbayListingCategory(listingId: string, actor: AuthUser) {
  const row = await prisma.ebayListing.findUnique({
    where: { id: listingId },
    select: {
      id: true, sku: true, marketplace: true, ebayListingId: true,
      product: { select: { id: true, name: true, categoryId: true, internalNotes: true } },
    },
  })
  if (!row) throw httpError(404, 'eBay listing not found')
  if (!row.ebayListingId) {
    throw httpError(400, 'This listing has no eBay item id — the category cannot be re-resolved from eBay')
  }

  const details = await getEbayItemDetails(row.ebayListingId)
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { sortOrder: 'asc' },
  })
  const { categoryId, assignment } = resolveCategoryId(
    {
      categoryId: details.categoryId || undefined,
      categoryName: details.categoryName || undefined,
      title: details.title || undefined,
      specifics: details.specifics,
    },
    categories,
  )
  if (!categoryId) {
    throw httpError(400, `Resolved category "${assignment.slug}" has no matching website category row — create it first`)
  }

  const currentSlug = categories.find((category) => category.id === row.product.categoryId)?.slug ?? null
  const changed = categoryId !== row.product.categoryId

  // The fallback is a safety net, not a decision: never downgrade a product
  // that already has a real category to 'other-business'. Mirrors the
  // recategorize script's kept-current rule.
  if (changed && assignment.confidence === 'fallback' && row.product.categoryId) {
    log.info(
      { listingId, sku: row.sku, keptSlug: currentSlug, reason: assignment.reason },
      'eBay Hub: category rules only reached the fallback — kept the current category',
    )
    return {
      changed: false,
      keptCurrent: true,
      categoryId: row.product.categoryId,
      slug: currentSlug || assignment.slug,
      previousSlug: currentSlug,
      confidence: assignment.confidence,
      reason: assignment.reason,
    }
  }

  if (changed) {
    const trace = `Category re-applied from eBay by admin (${assignment.confidence} → ${assignment.slug}): ${assignment.reason}`
    await prisma.product.update({
      where: { id: row.product.id },
      data: {
        categoryId,
        internalNotes: [row.product.internalNotes, trace].filter(Boolean).join('\n'),
      },
    })
    await logAudit({
      actor,
      action: 'ebay.listing.reapply-category',
      entityType: 'product',
      entityId: row.product.id,
      entityName: row.product.name,
      previousValue: { categoryId: row.product.categoryId, slug: currentSlug },
      newValue: { categoryId, slug: assignment.slug, confidence: assignment.confidence, reason: assignment.reason, itemId: row.ebayListingId },
    })
  }
  log.info(
    { listingId, sku: row.sku, itemId: row.ebayListingId, changed, slug: assignment.slug, confidence: assignment.confidence },
    'eBay Hub: category rules re-applied',
  )

  return {
    changed,
    keptCurrent: false,
    categoryId,
    slug: assignment.slug,
    previousSlug: changed ? currentSlug : null,
    confidence: assignment.confidence,
    reason: assignment.reason,
  }
}

/**
 * Active eBay listings with no mirror row yet.
 *
 * Deliberately keyed on the MIRROR ROW, not `linkedProduct`: the active-list
 * view also resolves a product by SKU alone, so a listing that matches a
 * catalog SKU but has no ebay_listings row reports as "linked" while nothing
 * tracks its quantity, ended-state or offer id. That is exactly the gap this
 * repair list exists to close — importing it creates the row ('linked').
 */
export async function listUnimportedActiveListings(maxPages = 10) {
  if (!isEbayConfigured()) {
    throw httpError(503, 'eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)')
  }
  type ActiveListing = Awaited<ReturnType<typeof getActiveEbayListings>>['listings'][number]
  const scannedListings: ActiveListing[] = []
  let total = 0
  let fetchedAt = new Date().toISOString()

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await getActiveEbayListings({ page, limit: 100 })
    total = result.pagination?.total ?? total
    fetchedAt = result.fetchedAt
    scannedListings.push(...result.listings)
    if (!result.pagination || page >= (result.pagination.totalPages || 1) || result.listings.length === 0) break
  }

  const itemIds = [...new Set(scannedListings.map((listing) => listing.itemId).filter((id): id is string => Boolean(id)))]
  const mappedIds = new Set<string>()
  const CHUNK = 500
  for (let offset = 0; offset < itemIds.length; offset += CHUNK) {
    const rows = await prisma.ebayListing.findMany({
      where: { ebayListingId: { in: itemIds.slice(offset, offset + CHUNK) } },
      select: { ebayListingId: true },
    })
    for (const row of rows) if (row.ebayListingId) mappedIds.add(row.ebayListingId)
  }

  const missing = scannedListings.filter((listing) => listing.itemId && !mappedIds.has(listing.itemId))
  return {
    listings: missing.slice(0, 200),
    totalActiveOnEbay: total,
    scanned: scannedListings.length,
    missingCount: missing.length,
    fetchedAt,
  }
}

// ─── eBay orders ───────────────────────────────────────────────

export async function listEbayHubOrders(query: { status?: string; search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))

  const where: Prisma.EbayOrderWhereInput = {}
  if (query.status) where.status = query.status
  if (query.search?.trim()) {
    const search = query.search.trim()
    where.OR = [
      { ebayOrderId: { contains: search } },
      { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [rows, total, statusGroups] = await Promise.all([
    prisma.ebayOrder.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, ebayOrderId: true, status: true, totalAmount: true, currency: true,
        lastError: true, processedAt: true, createdAt: true, updatedAt: true,
        order: {
          select: {
            id: true, orderNumber: true, status: true, total: true, currency: true,
            _count: { select: { items: true } },
          },
        },
      },
    }),
    prisma.ebayOrder.count({ where }),
    prisma.ebayOrder.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  return {
    orders: rows.map((row) => ({
      id: row.id,
      ebayOrderId: row.ebayOrderId,
      status: row.status,
      totalAmount: money(row.totalAmount),
      currency: row.currency,
      lastError: row.lastError,
      processedAt: row.processedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      order: row.order
        ? {
            id: row.order.id,
            orderNumber: row.order.orderNumber,
            status: row.order.status,
            total: money(row.order.total),
            currency: row.order.currency,
            itemCount: row.order._count.items,
          }
        : null,
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    statusCounts: countFrom(statusGroups),
  }
}

/**
 * Re-run the idempotent eBay order processor for one order. Useful after the
 * admin fixed an unmapped SKU: processed orders stay untouched (the processor
 * short-circuits), failed/ignored/stale-processing rows are retried.
 */
export async function retryEbayOrderProcessing(
  ebayOrderId: string,
  actor: AuthUser,
): Promise<ProcessEventResult> {
  const row = await prisma.ebayOrder.findUnique({ where: { ebayOrderId } })
  if (!row) throw httpError(404, 'eBay order not found')

  const result = await processEbayOrderEvent(
    `admin:${ebayOrderId}:${Date.now()}`,
    'ADMIN_RETRY',
    { orderId: ebayOrderId },
  )
  await logAudit({
    actor,
    action: 'ebay.order.retry',
    entityType: 'ebay_order',
    entityName: ebayOrderId,
    previousValue: { status: row.status },
    newValue: { result: result.status, note: result.note },
  })
  log.info({ ebayOrderId, result: result.status, actor: actor.email }, 'eBay order reprocessed by admin')
  return result
}

// ─── Webhook / notification log ────────────────────────────────

export async function listEbayHubEvents(query: { status?: string; topic?: string; search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))

  const where: Prisma.EbayEventLogWhereInput = {}
  if (query.status) where.status = query.status
  if (query.topic?.trim()) where.topic = { contains: query.topic.trim(), mode: 'insensitive' }
  if (query.search?.trim()) {
    const search = query.search.trim()
    where.OR = [
      { eventId: { contains: search } },
      { error: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [rows, total, statusGroups] = await Promise.all([
    prisma.ebayEventLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, eventId: true, topic: true, status: true, error: true,
        processedAt: true, createdAt: true, payload: true,
      },
    }),
    prisma.ebayEventLog.count({ where }),
    prisma.ebayEventLog.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  return {
    events: rows.map((row) => {
      let preview: string | null = null
      if (row.payload != null) {
        try {
          preview = JSON.stringify(row.payload).slice(0, 800)
        } catch {
          preview = null
        }
      }
      return {
        id: row.id,
        eventId: row.eventId,
        topic: row.topic,
        status: row.status,
        error: row.error,
        processedAt: row.processedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        payloadPreview: preview,
      }
    }),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    statusCounts: countFrom(statusGroups),
  }
}

export async function retryEbayEvent(eventId: string, actor: AuthUser): Promise<ProcessEventResult> {
  const row = await prisma.ebayEventLog.findUnique({ where: { eventId } })
  if (!row) throw httpError(404, 'eBay event not found')

  const payload = (row.payload ?? {}) as Record<string, unknown>
  // A 'received' row is a deferred delivery the processor still owns, so the
  // same event id is reused. Anything final gets a synthetic id so the
  // original history row keeps its status and the retry leaves its own trace.
  const retryEventId = row.status === 'received' ? row.eventId : `admin:${row.eventId}:${Date.now()}`
  const result = await processEbayOrderEvent(retryEventId, row.topic, payload)

  await logAudit({
    actor,
    action: 'ebay.event.retry',
    entityType: 'ebay_event',
    entityName: eventId,
    previousValue: { status: row.status, error: row.error },
    newValue: { retryEventId, result: result.status, note: result.note },
  })
  log.info({ eventId, retryEventId, topic: row.topic, result: result.status }, 'eBay event reprocessed by admin')
  return result
}

// ─── Settings (behaviour flags + category pins) ────────────────

export async function getEbayHubSettings() {
  const [categories] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, slug: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  return {
    connection: {
      configured: isEbayConfigured(),
      environment: (process.env.EBAY_ENV || 'sandbox').toLowerCase(),
      siteId: process.env.EBAY_SITE_ID || null,
      marketplace: 'EBAY_US',
    },
    flags: {
      fullMirror: {
        override: getEbayRuntimeFlag('fullMirror').override,
        source: mirrorModeSource(),
        effective: mirrorModeEnabled(),
        envDefault: envBool('EBAY_FULL_MIRROR'),
      },
      autoPublish: {
        override: getEbayRuntimeFlag('autoPublish').override,
        source: autoPublishSource(),
        effective: autoPublishEnabled(),
        envDefault: String(process.env.EBAY_AUTO_PUBLISH || '1').trim() !== '0',
      },
    },
    pins: activeCategoryPins(),
    adminPinCount: adminCategoryPinCount(),
    categories,
    limits: {
      importMaxImages: maxImportImages(),
      mirrorDeepBudget: deepSyncBudget(),
      autosyncIntervalMs: autoSyncIntervalMs(),
      imageBackfillBatch: envInt('EBAY_IMAGE_BACKFILL_BATCH', 4),
      imageBackfillTickMs: envInt('EBAY_IMAGE_BACKFILL_TICK_MS', 60_000),
      importBatchSize: envInt('EBAY_IMPORT_BATCH_SIZE', 4),
    },
  }
}

export interface EbayHubSettingsInput {
  fullMirror?: boolean | null
  autoPublish?: boolean | null
  categoryPins?: Record<string, string>
}

export async function saveEbayHubSettings(input: EbayHubSettingsInput, actor: AuthUser) {
  const changed: string[] = []
  if (input.fullMirror !== undefined) {
    await setEbayRuntimeFlag('fullMirror', input.fullMirror, actor)
    changed.push('fullMirror')
  }
  if (input.autoPublish !== undefined) {
    await setEbayRuntimeFlag('autoPublish', input.autoPublish, actor)
    changed.push('autoPublish')
  }
  if (input.categoryPins !== undefined) {
    const result = await setEbayCategoryPins(input.categoryPins, actor)
    changed.push(`categoryPins(${result.applied})`)
    if (result.invalid.length > 0) {
      log.warn({ invalid: result.invalid }, 'eBay Hub settings: unknown category slugs were skipped')
    }
  }
  log.info({ changed, actor: actor.email }, 'eBay Hub settings saved')
  return getEbayHubSettings()
}
