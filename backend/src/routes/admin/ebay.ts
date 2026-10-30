/**
 * Admin eBay routes (roadmap C25 + C30).
 *
 * All admin-authorized (inventory-manager+). The inventory view joins
 * products.stockCount (central truth) with the ebay_listings mirror so admins
 * see stock, eBay quantity, sync status, last error, and last sync time.
 */
import { Router } from 'express'
import { z } from 'zod'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler } from '../../middleware/validate.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import { prisma } from '../../server.js'
import { createListingForProduct } from '../../services/ebayListingService.js'
import { startListingPreviewsTask, pollListingPreviewsTask } from '../../services/ebayListingPreviewsService.js'
import { getActiveEbayListings } from '../../services/ebayTradingService.js'
import { syncNow } from '../../services/ebaySyncScheduler.js'
import { runAutoSyncTick, getLastAutoSyncSummary } from '../../services/ebayCatalogAutoSync.js'
import { autoPublishEnabled } from '../../services/ebayCatalogImportService.js'
import {
  startEbayImageBackfill,
  getImageBackfillJob,
  cancelEbayImageBackfill,
} from '../../services/ebayImageBackfill.js'
import {
  startEbayCatalogImport,
  getEbayCatalogImport,
  getLatestEbayCatalogImport,
  cancelEbayCatalogImport,
  importSingleEbayItem,
} from '../../services/ebayCatalogImportService.js'
import {
  getEbayHubOverview,
  listEbayHubListings,
  setEbayListingPaused,
  pushEbayListingQuantity,
  resyncEbayListing,
  reapplyEbayListingCategory,
  listUnimportedActiveListings,
  listEbayHubOrders,
  retryEbayOrderProcessing,
  listEbayHubEvents,
  retryEbayEvent,
  getEbayHubSettings,
  saveEbayHubSettings,
} from '../../services/ebayHubService.js'

const router = Router()
router.use(authenticateAdmin)

// ─── Inventory sync view ───────────────────────────────────────
router.get('/inventory', asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))

  const products = await prisma.product.findMany({
    where: { status: { not: 'archived' } },
    select: {
      id: true, sku: true, name: true, stockCount: true, availability: true, updatedAt: true,
      ebayListings: {
        select: {
          id: true, sku: true, marketplace: true, status: true,
          ebayOfferId: true, ebayListingId: true,
          lastSyncedQty: true, lastSyncAt: true, lastError: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  })

  const total = await prisma.product.count({ where: { status: { not: 'archived' } } })
  return sendSuccess(res, { products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
}))

// ─── Active eBay listings (read-only, Trading API) ─────────────
router.get('/active-listings', asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  try {
    const result = await getActiveEbayListings({ page, limit })
    return sendSuccess(res, result)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 502
    return sendError(res, (err as Error).message, status)
  }
}))

// ─── Manual "sync now" ─────────────────────────────────────────
router.post('/inventory/sync-now', requireRole('inventory-manager'), asyncHandler(async (_req: AuthRequest, res) => {
  const result = await syncNow()
  return sendSuccess(res, result)
}))

// ─── List a product on eBay (quantity forced from central stock) ──
// categoryId is OPTIONAL since the GraphQL listing previews landed: when it
// is omitted, the latest eBay preview supplies the recommended category id.
const createListingSchema = z.object({
  productId: z.string().uuid(),
  categoryId: z.string().min(1).max(20).optional(),
  price: z.number().positive().optional(),
  marketplace: z.string().max(20).optional(),
})

router.post('/listings', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = createListingSchema.safeParse(req.body)
  if (!parsed.success) {
    return sendError(res, 'productId is required; categoryId is required unless an eBay listing preview suggestion exists', 400)
  }
  try {
    const listing = await createListingForProduct(parsed.data, req.user!.id)
    return sendSuccess(res, { listing }, 201)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

// ═══════════════════════════════════════════════════════════════
// Listing previews (GraphQL Inventory Mapping API)
// ═══════════════════════════════════════════════════════════════
// startListingPreviewsCreation submits website products to eBay as an async
// batch; the Hub UI polls the task and the completed results land in
// ebay_listing_previews, from where "List on eBay" picks category + aspects.

const listingPreviewsRunSchema = z.object({
  // eBay's startListingPreviewsCreation accepts a maximum of 10 products.
  productIds: z.array(z.string().uuid()).max(10).optional(),
  marketplace: z.string().max(20).optional(),
})

router.post('/listing-previews/run', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = listingPreviewsRunSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return sendError(res, 'productIds must be at most 10 product ids (eBay caps the mapping mutation at 10)', 400)
  }
  try {
    const task = await startListingPreviewsTask(parsed.data ?? {}, req.user!.id)
    return sendSuccess(res, { task }, 202)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

/** Recent tasks (newest first) for the Hub's suggestion history. */
router.get('/listing-previews/tasks', asyncHandler(async (req: AuthRequest, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10))
  const tasks = await prisma.ebayListingPreviewTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, ebayTaskId: true, marketplace: true, status: true, total: true,
      created: true, unprocessed: true, unmapped: true, invalid: true,
      lastError: true, startedAt: true, finishedAt: true, createdAt: true,
    },
  })
  return sendSuccess(res, { tasks })
}))

/**
 * One task: live-polls eBay while 'running', then returns the flattened
 * previews with product sku/name. Intended to be polled by the UI.
 */
router.get('/listing-previews/tasks/:id', asyncHandler(async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return sendError(res, 'Invalid task id', 400)
  try {
    const task = await pollListingPreviewsTask(id.data)
    if (!task) return sendError(res, 'Listing previews task not found', 404)
    const previews = await prisma.ebayListingPreview.findMany({
      where: { taskId: task.ebayTaskId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, productId: true, status: true, outcome: true, reason: true,
        categoryId: true, categoryName: true, categoryLevel: true, epid: true,
        mappingReferenceId: true,
        suggestedTitle: true, aspects: true, updatedAt: true,
        product: { select: { sku: true, name: true } },
      },
    })
    return sendSuccess(res, { task, previews })
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

// ─── Import active eBay listings into the website catalog (drafts) ──
const catalogImportSchema = z.object({
  marketplace: z.string().max(20).optional(),
})

router.post('/catalog-import', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = catalogImportSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return sendError(res, 'Invalid catalog import request', 400)
  }
  try {
    const job = await startEbayCatalogImport({
      marketplace: parsed.data.marketplace,
      actor: req.user!,
    })
    return sendSuccess(res, { job }, 202)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

router.get('/catalog-import/latest', asyncHandler(async (req: AuthRequest, res) => {
  const marketplace = typeof req.query.marketplace === 'string' ? req.query.marketplace : undefined
  const job = await getLatestEbayCatalogImport(marketplace)
  return sendSuccess(res, { job })
}))

router.get('/catalog-import/:id', asyncHandler(async (req: AuthRequest, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id)
  if (!parsed.success) return sendError(res, 'Invalid import job id', 400)
  const job = await getEbayCatalogImport(parsed.data)
  if (!job) return sendError(res, 'Import job not found', 404)
  return sendSuccess(res, { job })
}))

router.post('/catalog-import/:id/cancel', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id)
  if (!parsed.success) return sendError(res, 'Invalid import job id', 400)
  const job = await cancelEbayCatalogImport(parsed.data)
  if (!job) return sendError(res, 'Import job not found', 404)
  return sendSuccess(res, { job })
}))

// ─── Catalog auto-sync (5-minute eBay→website reconciliation) ──
// Force-a-sweep goes through runAutoSyncTick, not sweepEbayCatalogAutoSync
// directly: if a scheduled sweep is already running, this returns 409 instead
// of starting a second concurrent sweep over the same listings (two walkers
// would double-enqueue imports and double-apply price/stock writes).
router.post('/catalog-autosync/run', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const summary = await runAutoSyncTick()
    if (!summary) {
      return sendError(res, 'A catalog auto-sync sweep is already running — check /catalog-autosync/status', 409)
    }
    return sendSuccess(res, { summary })
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

router.get('/catalog-autosync/status', asyncHandler(async (_req: AuthRequest, res) => {
  const [lastJob, statusCounts] = await Promise.all([
    getLatestEbayCatalogImport(),
    prisma.ebayListing.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  return sendSuccess(res, {
    lastSweep: getLastAutoSyncSummary(),
    lastImportJob: lastJob,
    autoPublishEnabled: autoPublishEnabled(),
    listingStatuses: statusCounts.map((row) => ({ status: row.status, count: row._count._all })),
  })
}))

// ─── Image backfill (one-shot photo re-mirror per mapped product) ──
// Walks every mapped, non-archived eBay listing and re-mirrors the listing's
// COMPLETE photo set — this is the "more than six photos on eBay show on the
// site" repair. Photo scope only: price/stock/copy stay as-is (use the
// catalog auto-sync for those).
router.get('/catalog-images-backfill', asyncHandler(async (_req: AuthRequest, res) => {
  return sendSuccess(res, { job: getImageBackfillJob() })
}))

router.post('/catalog-images-backfill', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const job = await startEbayImageBackfill({
      marketplace: (req.body?.marketplace as string | undefined)?.toUpperCase(),
    })
    return sendSuccess(res, { job }, 202)
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500
    return sendError(res, (err as Error).message, status)
  }
}))

router.post('/catalog-images-backfill/cancel', requireRole('inventory-manager'), asyncHandler(async (_req: AuthRequest, res) => {
  const job = await cancelEbayImageBackfill()
  if (!job || job.status === 'running') return sendError(res, 'No running image backfill to cancel', 400)
  return sendSuccess(res, { job })
}))

// ═══════════════════════════════════════════════════════════════
// eBay Hub — full admin control surface
// ═══════════════════════════════════════════════════════════════

/** Service errors carry an HTTP status; everything else is a 500. */
function sendServiceError(res: Parameters<typeof sendError>[0], err: unknown) {
  const status = (err as { status?: number }).status || 500
  return sendError(res, (err as Error).message, status)
}

// ─── Overview: connection, flags, counts, last runs, recent problems ──
router.get('/hub/overview', asyncHandler(async (_req: AuthRequest, res) => {
  const overview = await getEbayHubOverview()
  // Interface types have no implicit index signature; sendSuccess spreads a
  // plain record, so the boundary cast keeps the typed overview intact.
  return sendSuccess(res, overview as unknown as Record<string, unknown>)
}))

// ─── Mirror rows with filters, plus per-row repair actions ─────
router.get('/hub/listings', asyncHandler(async (req: AuthRequest, res) => {
  const result = await listEbayHubListings({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    marketplace: typeof req.query.marketplace === 'string' ? req.query.marketplace : undefined,
    paused: typeof req.query.paused === 'string' ? req.query.paused : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
  })
  return sendSuccess(res, result)
}))

const pauseListingSchema = z.object({ disabled: z.boolean() })

router.post('/hub/listings/:id/pause', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return sendError(res, 'Invalid eBay listing id', 400)
  const body = pauseListingSchema.safeParse(req.body ?? {})
  if (!body.success) return sendError(res, 'disabled (boolean) is required', 400)
  try {
    const listing = await setEbayListingPaused(id.data, body.data.disabled, req.user!)
    return sendSuccess(res, { listing })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

router.post('/hub/listings/:id/push-quantity', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return sendError(res, 'Invalid eBay listing id', 400)
  try {
    const result = await pushEbayListingQuantity(id.data)
    return sendSuccess(res, { result })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

router.post('/hub/listings/:id/resync', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return sendError(res, 'Invalid eBay listing id', 400)
  try {
    const result = await resyncEbayListing(id.data, req.user!)
    return sendSuccess(res, { result })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

router.post('/hub/listings/:id/reapply-category', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return sendError(res, 'Invalid eBay listing id', 400)
  try {
    const result = await reapplyEbayListingCategory(id.data, req.user!)
    return sendSuccess(res, { result })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

// ─── Active eBay listings with no product yet (missed imports) ──
router.get('/hub/unimported-listings', asyncHandler(async (req: AuthRequest, res) => {
  const maxPages = Math.min(20, Math.max(1, Number(req.query.pages) || 10))
  try {
    const result = await listUnimportedActiveListings(maxPages)
    return sendSuccess(res, result)
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

router.post('/hub/unimported-listings/:itemId/import', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const itemId = z.string().min(1).max(40).safeParse(req.params.itemId)
  if (!itemId.success) return sendError(res, 'Invalid eBay item id', 400)
  const marketplace = z.string().max(20).optional().safeParse(req.body?.marketplace)
  try {
    const result = await importSingleEbayItem(itemId.data, marketplace.success ? (marketplace.data || 'EBAY_US') : 'EBAY_US', req.user!)
    return sendSuccess(res, result)
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

// ─── eBay orders (webhook + poll results) ──────────────────────
router.get('/hub/orders', asyncHandler(async (req: AuthRequest, res) => {
  const result = await listEbayHubOrders({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
  })
  return sendSuccess(res, result)
}))

router.post('/hub/orders/:ebayOrderId/retry', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const orderId = z.string().min(1).max(80).safeParse(req.params.ebayOrderId)
  if (!orderId.success) return sendError(res, 'Invalid eBay order id', 400)
  try {
    const result = await retryEbayOrderProcessing(orderId.data, req.user!)
    return sendSuccess(res, { result })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

// ─── Notification / webhook log ────────────────────────────────
router.get('/hub/events', asyncHandler(async (req: AuthRequest, res) => {
  const result = await listEbayHubEvents({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    topic: typeof req.query.topic === 'string' ? req.query.topic : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    page: Number(req.query.page) || undefined,
    limit: Number(req.query.limit) || undefined,
  })
  return sendSuccess(res, result)
}))

router.post('/hub/events/:eventId/retry', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const eventId = z.string().min(1).max(200).safeParse(req.params.eventId)
  if (!eventId.success) return sendError(res, 'Invalid eBay event id', 400)
  try {
    const result = await retryEbayEvent(eventId.data, req.user!)
    return sendSuccess(res, { result })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

// ─── Settings: mirror/auto-publish overrides + category pins ───
const hubSettingsSchema = z.object({
  fullMirror: z.boolean().nullable().optional(),
  autoPublish: z.boolean().nullable().optional(),
  categoryPins: z.record(z.string(), z.string()).optional(),
})

router.get('/hub/settings', asyncHandler(async (_req: AuthRequest, res) => {
  return sendSuccess(res, await getEbayHubSettings())
}))

router.put('/hub/settings', requireRole('inventory-manager'), asyncHandler(async (req: AuthRequest, res) => {
  const parsed = hubSettingsSchema.safeParse(req.body ?? {})
  if (!parsed.success) return sendError(res, 'Invalid eBay settings payload', 400)
  try {
    const settings = await saveEbayHubSettings(parsed.data, req.user!)
    return sendSuccess(res, { settings })
  } catch (err) {
    return sendServiceError(res, err)
  }
}))

export default router
