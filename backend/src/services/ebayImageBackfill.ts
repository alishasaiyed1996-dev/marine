/**
 * eBay image backfill one-shot job.
 *
 * The original catalog import stored up to 6 photos per product, so every
 * product imported before the photo allowance was raised shows a cropped
 * photo set. The autosync deep pass eventually re-mirrors photos (rotating
 * GetItem window, ~2 hours per full catalog and only with EBAY_FULL_MIRROR
 * on) — too slow when the goal is "every missing photo, per product, now".
 *
 * This job does exactly that, nothing else: walk every non-ended
 * eBayListing mirror row for the marketplace, GetItem each listing, and run
 * mirrorProductImages() — adding the missing photos to Cloudinary, removing
 * photos that vanished from the listing, stamping provenance (source_url) so
 * the next passes are no-ops. Photo scope only: it never touches price,
 * stock, copy or category, so it is safe WITHOUT mirror mode. Idempotent
 * end-to-end: re-running it after a restart (or just because) adds nothing
 * for products already backfilled.
 *
 * Shape: same resumable background-job pattern as the catalog import —
 * snapshot the target list at start, process a small batch per tick,
 * cancelled via the admin route. In-memory job state; a restart resets it
 * and re-running is cheap.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { logAudit } from '../utils/audit.js'
import { isEbayConfigured, isRetryableError } from './ebayClient.js'
import { getEbayItemDetails } from './ebayTradingService.js'
import { mirrorProductImages } from './ebayCatalogImportService.js'

const log = logger.child({ context: 'ebay-image-backfill' })

export type ImageBackfillStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface PublicImageBackfillJob {
  status: ImageBackfillStatus
  marketplace: string
  total: number
  processed: number
  imagesAdded: number
  imagesRemoved: number
  productsChanged: number
  failures: number
  startedAt: string
  finishedAt: string | null
  lastError: string | null
  lastProcessedSku: string | null
}

interface BackfillTarget {
  itemId: string
  sku: string
  productId: string
  name: string
  /** Re-queue cap for transient failures (rate limit, timeout). */
  attempts: number
}

let job: PublicImageBackfillJob | null = null
let queue: BackfillTarget[] = []
let timer: ReturnType<typeof setInterval> | null = null
/** A cancelled run must not start the next batch mid-way. */
let processing = false

const DEFAULT_BATCH = 4
const DEFAULT_TICK_MS = 10_000

function envClamp(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  const value = Number.isFinite(parsed) ? Math.floor(parsed) : fallback
  return Math.max(min, Math.min(max, value))
}

/** Items per tick. Each item costs one GetItem + up to 24 photo downloads. */
function batchSize(): number {
  return envClamp('EBAY_IMAGE_BACKFILL_BATCH', DEFAULT_BATCH, 1, 12)
}

/** Tick cadence; 4 items / 10s ≈ full 1,000-listing catalog in ~45 min. */
function tickMs(): number {
  return envClamp('EBAY_IMAGE_BACKFILL_TICK_MS', DEFAULT_TICK_MS, 5_000, 120_000)
}

export function getImageBackfillJob(): PublicImageBackfillJob | null {
  return job
}

function serializeJob(): PublicImageBackfillJob | null {
  if (!job) return null
  return { ...job }
}

function startTimer(): void {
  if (timer) return
  timer = setInterval(() => { void processBatch() }, tickMs())
}

function stopTimer(): void {
  if (timer) { clearInterval(timer); timer = null }
}

function finalize(status: ImageBackfillStatus, error?: string): void {
  if (!job) return
  job.status = status
  job.finishedAt = new Date().toISOString()
  if (error) job.lastError = error.slice(0, 500)
  stopTimer()
  logAudit({
    action: 'ebay.images_backfill',
    entityType: 'ebay_image_backfill',
    entityName: `images ${job.marketplace}`,
    newValue: { ...serializeJob()! },
  })
  log.info({ summary: serializeJob() }, 'EBAY_IMAGE_BACKFILL finished')
  // Keep the singleton as read-only history ("completed/failed/cancelled"):
  // the admin page reads it on load so the last run's numbers survive reloads,
  // and startEbayImageBackfill only refuses when status === 'running'.
}

export async function startEbayImageBackfill(input: { marketplace?: string }): Promise<PublicImageBackfillJob> {
  if (!isEbayConfigured()) {
    throw Object.assign(
      new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'),
      { status: 503 },
    )
  }
  if (job?.status === 'running') {
    throw Object.assign(new Error(`An image backfill is already running (started ${job.startedAt}).`), { status: 409 })
  }

  const marketplace = String(input.marketplace || 'EBAY_US').toUpperCase()
  const listings = await prisma.ebayListing.findMany({
    where: { marketplace, status: { not: 'ended' } },
    select: {
      ebayListingId: true,
      sku: true,
      product: { select: { id: true, name: true, status: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })
  const targets: BackfillTarget[] = listings
    .filter((row): row is (typeof listings)[number] & { ebayListingId: string } =>
      Boolean(row.ebayListingId && row.product.status !== 'archived'))
    .map((row) => ({
      itemId: row.ebayListingId,
      sku: row.sku,
      productId: row.product.id,
      name: row.product.name,
      attempts: 0,
    }))
  if (targets.length === 0) {
    throw Object.assign(new Error(`No mapped products found for ${marketplace} — run the catalog import first`), { status: 400 })
  }

  queue = targets
  job = {
    status: 'running',
    marketplace,
    total: targets.length,
    processed: 0,
    imagesAdded: 0,
    imagesRemoved: 0,
    productsChanged: 0,
    failures: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    lastProcessedSku: null,
  }
  logAudit({
    action: 'ebay.images_backfill',
    entityType: 'ebay_image_backfill',
    entityName: `start images ${marketplace}`,
    newValue: { total: targets.length },
  })
  log.info({ marketplace, total: targets.length, batch: batchSize(), tickMs: tickMs() }, 'EBAY_IMAGE_BACKFILL started')
  startTimer()
  // Kick the first batch this second instead of waiting one tick.
  void processBatch()
  return job
}

export async function cancelEbayImageBackfill(): Promise<PublicImageBackfillJob | null> {
  if (!job || job.status !== 'running') return serializeJob()
  queue = []
  finalize('cancelled')
  return serializeJob()
}

async function processBatch(): Promise<void> {
  if (processing || !job || job.status !== 'running') return
  processing = true
  try {
    const slice = queue.splice(0, batchSize())
    if (slice.length === 0) {
      finalize('completed')
      return
    }
    for (const target of slice) {
      if (!job || job.status !== 'running') return // cancelled mid-batch
      try {
        const details = await getEbayItemDetails(target.itemId)
        const result = await mirrorProductImages({
          productId: target.productId,
          itemId: target.itemId,
          name: details.title?.trim() || target.name,
          imageUrls: details.images,
        })
        job.imagesAdded += result.added
        job.imagesRemoved += result.removed
        if (result.added > 0 || result.removed > 0) job.productsChanged += 1
        log.info(
          { sku: target.sku, itemId: target.itemId, imagesAdded: result.added, imagesRemoved: result.removed },
          'eBay image backfill: photos re-mirrored',
        )
      } catch (err) {
        const transient = isRetryableError(err)
        if (transient && target.attempts < 2) {
          target.attempts += 1
          queue.push(target) // rate limit / timeout — try again later this run
          log.warn({ err: (err as Error).message, sku: target.sku, itemId: target.itemId, attempt: target.attempts }, 'eBay image backfill: transient failure — re-queued')
        } else {
          job.failures += 1
          job.lastError = (err as Error).message.slice(0, 500)
          log.warn({ err, sku: target.sku, itemId: target.itemId }, 'eBay image backfill: item failed (skipped)')
        }
      }
      job.processed += 1
      job.lastProcessedSku = target.sku
    }
  } catch (fatal) {
    // Unknown crash — stop the run; the summary says exactly where it died.
    log.error({ err: fatal }, 'eBay image backfill crashed')
    finalize('failed', (fatal as Error).message)
    processing = false
    return
  }
  processing = false
}
