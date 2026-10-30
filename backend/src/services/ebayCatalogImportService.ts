/**
 * eBay → website catalog import (MANUAL_TASKS MT-13).
 *
 * The admin "Active eBay Listings" view is read-only. This service adds the
 * write half: it turns selected active listings into DRAFT products so the
 * normal publish gate (category, description, SEO, identity, image alt text)
 * still applies before anything becomes public.
 *
 * Safety rules:
 *  - Marketplace is explicit (default EBAY_US); cross-marketplace duplicates
 *    are ignored.
 *  - Idempotent: an eBay item already mapped is skipped; a listing whose SKU
 *    already exists in the catalog is linked instead of duplicated.
 *  - Images are mirrored to Cloudinary (up to eBay's 24-photo allowance) so
 *    the storefront never depends on eBay's image CDN; revisions to a
 *    listing's photo set are re-mirrored by the autosync deep pass.
 *  - Central stock starts at the eBay quantity. The listing row is marked
 *    'synced' with that quantity, so the first real drift triggers the normal
 *    reconciliation path (Trading API ReviseInventoryStatus for imported rows
 *    without an Inventory API offer id).
 *
 * Runs as a resumable background job (EbayImportJob): discovery, then batches
 * of four items. Progress is persisted after every item, so a restart resumes
 * from the cursor instead of re-calling eBay for the whole store.
 */
import type { EbayImportJob } from '@prisma/client'
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { generateSlug } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import type { AuthUser } from '../middleware/auth.js'
import { isEbayConfigured, isRetryableError } from './ebayClient.js'
import { getActiveEbayListings, getEbayItemDetails, type ActiveEbayListing, type EbayItemDetails } from './ebayTradingService.js'
import { importMediaFromUrl } from './mediaService.js'
import {
  cleanTitle,
  extractIdentity,
  htmlToPlainText,
  mapEbayCondition,
  matchBrandId,
  resolveCategoryId,
  normalizeCurrency,
  normalizeEbaySku,
} from './ebayCatalogMapping.js'
import {
  makeUniqueSeoTitle,
  normalizeProductContent,
} from './productContentNormalizer.js'
import { isProductPublishable } from './productMutations.js'
import { contentPatch, maxImportImages, planImageSync, specSignature } from './ebayMirror.js'

const log = logger.child({ context: 'ebay-catalog-import' })

export const DEFAULT_IMPORT_MARKETPLACE = 'EBAY_US'
const DISCOVERY_PAGE_SIZE = 200
const DISCOVERY_MAX_PAGES = 500
/**
 * Temporary staging positions for a kept photo while a mirror pass is
 * reshuffling. Negative so it can never overlap the real 0..23 slots or any
 * historical position; every staged row gets a unique value, which the
 * (productId, sortOrder) unique key demands during multi-row moves.
 */
const TEMP_SORT_BASE = 1000

/**
 * Auto-publish gate for the catalog auto-sync (requirement: a newly listed
 * eligible eBay product must be on the website within 5 minutes). DRAFT-only
 * would leave every new import invisible until an admin publishes it
 * manually, so auto-sync publishes when the product already passes the exact
 * same publish checks the admin UI enforces (category, substantive
 * description, SEO lengths, an identity field, images with alt text, no
 * duplicate description). `EBAY_AUTO_PUBLISH=0` restores manual-only.
 *
 * eBay Hub override: the admin toggle (StoreSetting `ebay.autoPublish`)
 * flips this at runtime without a redeploy — see ebayAdminRuntime.ts.
 */
export function autoPublishEnabled(): boolean {
  if (autoPublishOverride !== null) return autoPublishOverride
  return String(process.env.EBAY_AUTO_PUBLISH || '1').trim() !== '0'
}

/** Where the effective auto-publish decision comes from (toggle wins over env). */
export function autoPublishSource(): 'admin' | 'env' {
  return autoPublishOverride !== null ? 'admin' : 'env'
}

let autoPublishOverride: boolean | null = null

/** eBay Hub toggle hook — true/false overrides env, null clears the override. */
export function setEbayAutoPublishOverride(value: boolean | null): void {
  autoPublishOverride = value === undefined ? null : value
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name])
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function batchSize(): number {
  return envInt('EBAY_IMPORT_BATCH_SIZE', 4, 1, 25)
}

/** Photos mirrored per listing — eBay's full allowance (see ebayMirror.ts). */
function maxImages(): number {
  return maxImportImages()
}

/** Transient = pause the batch and retry the same item on the next tick. */
function isTransientImportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  // A permanently bad token is not fixed by retrying, and retrying would
  // stall the cursor forever.
  if (/not configured|invalid_grant|OAuth failed \(401\)/i.test(message)) return false
  if (isRetryableError(err)) return true
  return /call limit|rate limit|too many requests|try again later|temporarily unavailable/i.test(message)
}

// ─── Job API ───────────────────────────────────────────────────

export interface PublicEbayImportJob extends Omit<EbayImportJob, 'itemIds'> {
  remaining: number
}

export function serializeImportJob(job: EbayImportJob): PublicEbayImportJob {
  const { itemIds: _itemIds, ...rest } = job
  return { ...rest, remaining: Math.max(0, job.total - job.cursor) }
}

export async function startEbayCatalogImport(input: { marketplace?: string; actor: AuthUser }): Promise<PublicEbayImportJob> {
  if (!isEbayConfigured()) {
    throw Object.assign(
      new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'),
      { status: 503 },
    )
  }

  const marketplace = String(input.marketplace || DEFAULT_IMPORT_MARKETPLACE).trim().toUpperCase() || DEFAULT_IMPORT_MARKETPLACE
  if (marketplace !== DEFAULT_IMPORT_MARKETPLACE) {
    // GetMyeBaySelling is called with EBAY_SITE_ID (0 = EBAY_US). Supporting
    // another site needs a per-marketplace site id, so fail loudly instead of
    // discovering US listings and importing nothing.
    throw Object.assign(
      new Error(`Only ${DEFAULT_IMPORT_MARKETPLACE} catalog imports are supported right now`),
      { status: 400 },
    )
  }
  const active = await prisma.ebayImportJob.findFirst({
    where: { marketplace, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (active) {
    throw Object.assign(
      new Error(`An eBay import is already ${active.status} for ${marketplace} (job ${active.id}).`),
      { status: 409, job: serializeImportJob(active) },
    )
  }

  const job = await prisma.ebayImportJob.create({
    data: { marketplace, createdBy: input.actor.id },
  })

  // Start in the background; the scheduler is the durable runner.
  void processEbayImportJobs().catch((err) => log.error({ err }, 'eBay import start tick failed'))
  return serializeImportJob(job)
}

export async function getEbayCatalogImport(id: string): Promise<PublicEbayImportJob | null> {
  const job = await prisma.ebayImportJob.findUnique({ where: { id } })
  return job ? serializeImportJob(job) : null
}

/**
 * Enqueue item ids for the catalog auto-sync (createdBy = null marks the job
 * as system-owned). New ids are merged into an already-active autosync job
 * instead of stacking a second job per sweep: appending only grows the tail of
 * the work list, so the persisted cursor stays valid, and importOne's per-item
 * dedupe makes repeated ids harmless.
 */
export async function enqueueCatalogImport(itemIds: string[], marketplace = DEFAULT_IMPORT_MARKETPLACE): Promise<{ job: PublicEbayImportJob; added: number; merged: boolean }> {
  if (!isEbayConfigured()) {
    throw Object.assign(new Error('eBay is not configured'), { status: 503 })
  }
  const deduped = [...new Set(itemIds.filter((id) => typeof id === 'string' && id))]
  if (deduped.length === 0) {
    throw Object.assign(new Error('No eBay item ids to import'), { status: 400 })
  }

  const activeAutosync = await prisma.ebayImportJob.findFirst({
    where: { marketplace, status: { in: ['queued', 'running'] }, createdBy: null },
    orderBy: { createdAt: 'desc' },
  })
  if (activeAutosync) {
    const current = Array.isArray(activeAutosync.itemIds)
      ? (activeAutosync.itemIds as unknown[]).filter((value): value is string => typeof value === 'string' && Boolean(value))
      : []
    const seen = new Set(current)
    const fresh = deduped.filter((id) => !seen.has(id))
    if (fresh.length === 0) {
      return { job: serializeImportJob(activeAutosync), added: 0, merged: true }
    }
    const itemIds = [...current, ...fresh]
    const job = await prisma.ebayImportJob.update({
      where: { id: activeAutosync.id },
      data: { itemIds, total: itemIds.length, lastError: null },
    })
    void processEbayImportJobs().catch((err) => log.error({ err }, 'eBay autosync import kick failed'))
    return { job: serializeImportJob(job), added: fresh.length, merged: true }
  }

  const job = await prisma.ebayImportJob.create({
    data: {
      marketplace,
      itemIds: deduped,
      total: deduped.length,
      createdBy: null,
    },
  })
  void processEbayImportJobs().catch((err) => log.error({ err }, 'eBay autosync import kick failed'))
  return { job: serializeImportJob(job), added: deduped.length, merged: false }
}

export async function getLatestEbayCatalogImport(marketplace?: string): Promise<PublicEbayImportJob | null> {
  const job = await prisma.ebayImportJob.findFirst({
    where: marketplace ? { marketplace: marketplace.toUpperCase() } : {},
    orderBy: { createdAt: 'desc' },
  })
  return job ? serializeImportJob(job) : null
}

export async function cancelEbayCatalogImport(id: string): Promise<PublicEbayImportJob | null> {
  const existing = await prisma.ebayImportJob.findUnique({ where: { id } })
  if (!existing) return null
  if (existing.status !== 'queued' && existing.status !== 'running') {
    return serializeImportJob(existing)
  }
  const job = await prisma.ebayImportJob.update({
    where: { id },
    data: { status: 'cancelled', finishedAt: new Date() },
  })
  pausedUntil.delete(id)
  return serializeImportJob(job)
}

// ─── Worker ────────────────────────────────────────────────────

export interface ActiveListingsWalk {
  /** Eligible ActiveList ItemIDs (deduped, marketplace-filtered). */
  itemIds: string[]
  /** eBay's TotalNumberOfEntries from the walk (all marketplaces). */
  totalEntries: number
  /** Listings actually returned across the pages (all marketplaces). */
  returnedCount: number
  /** Active listing payload per id (price/quantity snapshot for the sweep). */
  listingsById: Map<string, ActiveEbayListing>
  /** True only when the walk returned the full set eBay reported. End-detection
   *  must not run on a walk that came back short — a truncated walk would
   *  false-flag live listings as ended. */
  complete: boolean
  /** Listings on pages that were skipped by the marketplace filter. */
  skippedOtherMarketplace: number
}

/**
 * Walk the account's ActiveList page by page.
 *
 * Old behavior (removed): total pages were trusted from page 1 only, and an
 * empty page ended the walk — a transient truncation silently dropped every
 * listing after that page, which is exactly how the known 1,090↔1,074 catalog
 * drift could widen. Now:
 *   - total pages are re-read from every response and extended when eBay
 *     grows the set mid-walk;
 *   - an unexpectedly empty page is retried twice before failing loudly
 *     (empty page + remaining pages → error, never a silent truncation);
 *   - the caller learns whether the walk completed so catalog reconciliation
 *     can be skipped on suspect data.
 */
export async function walkActiveListings(
  marketplace: string,
  options: { pageLimit?: number; maxPages?: number; failOnIncomplete?: boolean } = {},
): Promise<ActiveListingsWalk> {
  const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageLimit || DISCOVERY_PAGE_SIZE)))
  const maxPages = Math.min(DISCOVERY_MAX_PAGES, Math.max(1, Math.floor(options.maxPages || DISCOVERY_MAX_PAGES)))
  const ids = new Set<string>()
  const listingsById = new Map<string, ActiveEbayListing>()
  let totalEntries = 0
  let totalPagesOnLastReport = 1
  let returnedCount = 0
  let skippedOtherMarketplace = 0
  let pagesFetched = 0

  for (let page = 1; page <= totalPagesOnLastReport && page <= maxPages; page += 1) {
    let listings: ActiveEbayListing[] = []
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await getActiveEbayListings({ page, limit: pageSize })
      // eBay's totals can lag one page behind the item amble; trust the most
      // recent report and let it grow/shrink the plan.
      totalPagesOnLastReport = Math.max(1, Math.min(maxPages, result.pagination.totalPages || 1))
      totalEntries = Math.max(totalEntries, result.pagination.total ?? 0)
      listings = result.listings
      if (result.listings.length > 0) break
      if (page >= totalPagesOnLastReport) break // genuinely last page
      if (attempt < 3) {
        log.warn({ page, attempt, totalEntries, totalPagesOnLastReport }, 'eBay ActiveList page came back empty mid-walk — re-fetching')
        continue
      }
    }

    if (listings.length === 0 && page < totalPagesOnLastReport) {
      // Fail loudly: silently skipping a page is how valid listings stop
      // appearing on the website.
      throw Object.assign(
        new Error(`eBay ActiveList page ${page} of ${totalPagesOnLastReport} returned no items after retries — review the eBay sync logs`),
        { status: 502 },
      )
    }
    if (listings.length === 0 && page >= totalPagesOnLastReport) break

    pagesFetched = page
    for (const listing of listings) {
      if (listing.marketplace !== marketplace) {
        skippedOtherMarketplace += 1
        continue
      }
      if (listing.itemId) {
        ids.add(listing.itemId)
        listingsById.set(listing.itemId, listing)
      }
    }
    returnedCount += listings.length
  }

  // Complete when either signal says the full set came back: entries returned
  // cover eBay's total, or every reported page was fetched. An empty final
  // page (totalPages off by one) still counts as complete; a mid-walk
  // truncation satisfies neither and stays incomplete.
  const complete = returnedCount >= totalEntries || pagesFetched >= totalPagesOnLastReport
  if (!complete) {
    const message = `eBay ActiveList walk incomplete: fetched ${pagesFetched}/${totalPagesOnLastReport} pages, ${returnedCount}/${totalEntries} entries`
    log.warn({ marketplace, totalEntries, returnedCount, pagesFetched, totalPagesOnLastReport }, `(${message}) — treating mapped-but-unused listings cautiously`)
    if (options.failOnIncomplete) throw Object.assign(new Error(message), { status: 502 })
  }

  return { itemIds: [...ids], totalEntries, returnedCount, listingsById, complete, skippedOtherMarketplace }
}

/** Back-compat shim: just the eligible item ids. */
async function discoverItemIds(marketplace: string): Promise<string[]> {
  const walk = await walkActiveListings(marketplace)
  return walk.itemIds
}

async function loadLookup() {
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.brand.findMany({ select: { id: true, name: true } }),
  ])
  return { categories, brands }
}

async function uniqueProductSlug(title: string, itemId: string): Promise<string> {
  const base = generateSlug(title).slice(0, 200).replace(/-+$/g, '')
    || generateSlug(`ebay item ${itemId}`)
    || `ebay-item-${itemId}`
  let candidate = base

  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const [current, historical] = await Promise.all([
      prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } }),
      prisma.productSlugHistory.findUnique({ where: { slug: candidate }, select: { id: true } }),
    ])
    if (!current && !historical) return candidate
    candidate = `${base}-${suffix}`
  }

  return `${base}-${Date.now().toString(36)}`
}

export type ImportOutcome = 'created' | 'linked' | 'skipped' | 'failed'

async function importOne(
  itemId: string,
  marketplace: string,
  jobId: string,
  lookup: { categories: Array<{ id: string; slug?: string | null; name: string }>; brands: Array<{ id: string; name: string }> },
  actorId: string | null,
  usedSeoTitles: Set<string>,
): Promise<ImportOutcome> {
  const mapped = await prisma.ebayListing.findFirst({
    where: { ebayListingId: itemId },
    select: { id: true },
  })
  if (mapped) return 'skipped'

  const details = await getEbayItemDetails(itemId)
  if (details.marketplace !== marketplace) return 'skipped'

  const title = cleanTitle(details.title) || `eBay item ${itemId}`
  const sku = normalizeEbaySku(details.sku, itemId)

  // An existing catalog product with the same SKU is the canonical link (the
  // project treats SKU as the cross-channel key). Never fork a duplicate.
  const existingProduct = await prisma.product.findUnique({
    where: { sku },
    select: { id: true },
  })
  if (existingProduct) {
    const mapping = await prisma.ebayListing.findUnique({
      where: { sku_marketplace: { sku, marketplace } },
      select: { id: true },
    })
    if (!mapping) {
      await prisma.ebayListing.create({
        data: {
          productId: existingProduct.id,
          sku,
          ebayListingId: itemId,
          marketplace,
          // The existing catalog product is authoritative for stock. Do not
          // pretend eBay already matches it: enqueue a push so the two sides
          // converge on the website's quantity.
          status: 'sync-pending',
          lastSyncedQty: null,
          lastError: 'linked existing SKU — central stock will be pushed to eBay',
        },
      })
    } else {
      log.warn({ itemId, sku, marketplace }, 'eBay import: SKU already mapped; extra listing not stored (one row per SKU+marketplace)')
    }
    return 'linked'
  }

  const plainDescription = htmlToPlainText(details.descriptionHtml)
  const identity = extractIdentity(details.specifics)
  const condition = mapEbayCondition(details.condition)
  const normalized = normalizeProductContent({
    name: title,
    sku,
    condition,
    conditionNotes: details.condition,
    manufacturer: identity.manufacturer,
    modelNumber: identity.modelNumber,
    mpn: identity.mpn,
    impaCode: identity.impaCode,
    description: plainDescription,
    specs: details.specifics,
    categoryName: details.categoryName,
  })
  normalized.seoTitle = makeUniqueSeoTitle(
    normalized.seoTitle,
    sku || normalized.modelNumber || normalized.mpn,
    usedSeoTitles,
  )
  const price = details.price != null && Number.isFinite(details.price) ? details.price : 0
  const stockCount = Math.max(0, Math.floor(details.quantity || 0))
  // Category: eBay category id/name plus the listing content (title, item
  // specifics) — never just the raw category name substring match that made
  // almost every row uncategorized or mis-categorized.
  const { categoryId, assignment } = resolveCategoryId(
    {
      categoryId: details.categoryId,
      categoryName: details.categoryName,
      title,
      specifics: details.specifics,
    },
    lookup.categories,
  )
  const brandId = matchBrandId(normalized.manufacturer, lookup.brands)

  const product = await prisma.product.create({
    data: {
      name: normalized.name,
      slug: await uniqueProductSlug(normalized.name, itemId),
      sku,
      // Draft is deliberate: the publish gate (category, description, SEO,
      // verified identity, image alt text) runs before anything goes public.
      status: 'draft',
      brandId,
      categoryId,
      condition,
      availability: stockCount > 0 ? 'in-stock' : 'out-of-stock',
      description: normalized.description,
      shortDescription: normalized.shortDescription,
      regularPrice: price,
      currency: normalizeCurrency(details.currency),
      stockCount,
      conditionNotes: details.condition || null,
      manufacturer: normalized.manufacturer,
      modelNumber: normalized.modelNumber,
      mpn: normalized.mpn,
      gtin: identity.gtin,
      impaCode: normalized.impaCode,
      sourceUrl: details.listingUrl,
      // Parsed eBay specifics are not human verification; leave lastVerifiedAt
      // NULL so the admin verifies identity before publishing.
      seoTitle: normalized.seoTitle,
      seoDescription: normalized.seoDescription,
      seoKeywords: normalized.keywords.join(', '),
      keyFeatures: normalized.keyFeatures,
      includedItems: normalized.includedItems,
      internalNotes: `Imported from eBay item ${itemId} (${marketplace})${details.categoryName ? ` — eBay category: ${details.categoryName}` : ''}. Category assigned: ${assignment.confidence} → ${assignment.slug} (${assignment.reason}).`,
      createdBy: actorId,
      updatedBy: actorId,
    },
  })

  for (const [index, spec] of normalized.specs.entries()) {
    await prisma.productSpec.create({
      data: {
        productId: product.id,
        name: spec.name.slice(0, 255),
        value: spec.value,
        isPublic: true,
        sortOrder: index,
      },
    })
  }

  // Images are best-effort: a failed download must not fail the product.
  // Bounded mirroring (each download + sharp + Cloudinary round-trip is the
  // slowest unit of an import) — see mirrorProductImages below.
  await mirrorProductImages({
    productId: product.id,
    itemId,
    name: normalized.name,
    imageUrls: details.images,
    actorId: actorId || undefined,
  })

  // Auto-publish: the catalog must reflect new eligible eBay listings within
  // minutes of being listed, which drafts alone cannot do. Publish through the
  // exact same gate the admin UI enforces; failures keep the draft and are
  // logged with the precise missing requirements.
  if (autoPublishEnabled()) {
    try {
      const gate = await isProductPublishable(product, product.id)
      if (gate.ok) {
        await prisma.product.update({
          where: { id: product.id },
          data: { status: 'published', contentUpdatedAt: new Date() },
        })
        publishedCounts.set(jobId, (publishedCounts.get(jobId) ?? 0) + 1)
        log.info({ itemId, sku, slug: product.slug, category: assignment.slug }, 'eBay catalog import: product auto-published (publish gate passed)')
        await logAudit({
          action: 'product.publish.auto',
          entityType: 'product',
          entityId: product.id,
          entityName: product.name,
          newValue: { id: product.id, sku, status: 'published', source: 'ebay-auto-sync', itemId },
        })
      } else {
        log.info({ itemId, sku, reasons: gate.reasons }, 'eBay catalog import: product stays draft — automated publish gate not passed')
      }
    } catch (gateError) {
      log.warn({ err: gateError, itemId, sku }, 'eBay catalog import: auto-publish check failed — leaving product as draft')
    }
  }

  await prisma.ebayListing.create({
    data: {
      productId: product.id,
      sku,
      ebayListingId: itemId,
      marketplace,
      // Snapshot matches central stock exactly; the next real drift is picked
      // up by reconcileEbayQuantities and pushed via ReviseInventoryStatus.
      status: 'synced',
      lastSyncedQty: stockCount,
      lastSyncAt: new Date(),
    },
  })

  return 'created'
}

/**
 * Import ONE active eBay listing on demand (eBay Hub repair path).
 *
 * Discovery + import normally run as a background job; the Hub needs the same
 * idempotent work for a single item the sweep missed or that was ended and
 * re-listed. Reuses importOne exactly: an already-mapped item is 'skipped',
 * an existing catalog SKU is 'linked' (never duplicated), a new item becomes
 * a draft product and passes the same publish gate.
 */
export async function importSingleEbayItem(
  itemId: string,
  marketplace: string,
  actor: AuthUser | null,
): Promise<{ outcome: ImportOutcome; productId: string | null }> {
  if (!isEbayConfigured()) {
    throw Object.assign(
      new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'),
      { status: 503 },
    )
  }
  if (!itemId) throw Object.assign(new Error('eBay item id is required'), { status: 400 })

  const lookup = await loadLookup()
  const outcome = await importOne(
    itemId,
    String(marketplace || DEFAULT_IMPORT_MARKETPLACE).toUpperCase(),
    `admin-single:${Date.now()}`,
    lookup,
    actor?.id ?? null,
    new Set<string>(),
  )

  const mapping = await prisma.ebayListing.findFirst({
    where: { ebayListingId: itemId },
    select: { productId: true },
  })
  await logAudit({
    actor: actor || undefined,
    action: 'ebay.item.import',
    entityType: 'ebay_listing',
    entityId: mapping?.productId,
    entityName: itemId,
    newValue: { itemId, marketplace, outcome, productId: mapping?.productId ?? null },
  })
  log.info({ itemId, marketplace, outcome, productId: mapping?.productId ?? null, actor: actor?.email }, 'eBay Hub: single listing imported')
  return { outcome, productId: mapping?.productId ?? null }
}

/** Outcome of a product-image mirroring pass. */
export interface ProductImageSyncResult {
  added: number
  removed: number
  mainUrl: string | null
}

/**
 * Bring one product's photo set in line with its eBay listing (mirror scope).
 *
 * Used twice: by the import path at product creation (first mirroring) and by
 * the autosync deep pass whenever a seller revises a listing's photos later —
 * new photos are downloaded and mirrored to Cloudinary, vanished photos are
 * dropped from the site, and eBay's order stays the display order with image
 * #0 as the main/OG image.
 *
 * Unchanged photos are identified by PROVENANCE (the row's source eBay URL,
 * see planImageSync) and are kept — only their sort order / main flag / alt
 * text are re-asserted. Legacy rows predating provenance have no source URL,
 * so their first mirror pass is a one-time full replacement (expected — that
 * is exactly what backfills listings cropped to ≤6 photos before).
 *
 * The (productId, sortOrder) unique key makes write order matter: deletes
 * first, then kept rows are parked in a negative staging band, then new
 * rows are created in the 0..n band, then kept rows settle at their final
 * positions — every step is conflict-free. Best-effort per photo: a failed
 * download skips only that photo and logs — a product with stale photos
 * beats a broken mirror on an eBay CDN hiccup.
 */
export async function mirrorProductImages(input: {
  productId: string
  itemId: string
  name: string
  imageUrls: string[]
  actorId?: string
}): Promise<ProductImageSyncResult> {
  const desired = [...new Set(input.imageUrls.filter(Boolean))].slice(0, maxImages())
  const desiredUrls = new Set(desired)

  const [existing, current] = await Promise.all([
    prisma.productImage.findMany({
      where: { productId: input.productId },
      select: { id: true, url: true, sourceUrl: true, altText: true },
    }),
    prisma.product.findUnique({
      where: { id: input.productId },
      select: { ogImageUrl: true },
    }),
  ])
  const plan = planImageSync(existing, desired)

  // Exactly one keeper per desired photo. Duplicate rows for the same photo
  // (possible in legacy data) go out with the removals — the
  // (productId, sortOrder) unique key allows only one row per slot.
  const keepers = new Map<string, { id: string; url: string; altText: string | null }>()
  const surplusIds = new Set<string>()
  for (const row of existing) {
    const home = row.sourceUrl ?? row.url
    if (!desiredUrls.has(home)) continue // already queued for removal
    if (keepers.has(home)) surplusIds.add(row.id)
    else keepers.set(home, { id: row.id, url: row.url, altText: row.altText })
  }
  const removeIds = new Set([...plan.toRemove, ...surplusIds])

  // 1. Removals first — their sort slots become free for the settle pass.
  if (removeIds.size > 0) {
    await prisma.productImage.deleteMany({
      where: { id: { in: [...removeIds] }, productId: input.productId },
    })
  }

  // 2. Park kept rows in a negative staging band. Every value is unique and
  //    the band is virgin territory (legacy positions are 0..23), so moving
  //    several rows "out of the way" cannot hit the unique key even mid-loop.
  //    desired indices are disjoint between kept and newly-mirrored photos,
  //    so the final settle in (3)+(4) can never collide either.
  const keptByIndex = new Map<number, { id: string; url: string; altText: string | null; home: string }>()
  for (const [home, row] of keepers.entries()) {
    keptByIndex.set(desired.indexOf(home), { ...row, home })
  }
  for (const [index, row] of keptByIndex.entries()) {
    await prisma.productImage.update({
      where: { id: row.id },
      data: { sortOrder: -(TEMP_SORT_BASE + index), isMain: false },
    })
  }

  // 3. Mirror and create the photos the site is missing, in the free band.
  const mirrored = await Promise.all(plan.toAdd.map(async (imageUrl) => {
    try {
      const { asset } = await importMediaFromUrl(
        imageUrl,
        input.actorId || undefined,
        `${input.name} - image ${desired.indexOf(imageUrl) + 1}`,
      )
      return { url: asset.url, assetId: asset.id, sourceUrl: imageUrl, index: desired.indexOf(imageUrl) }
    } catch (err) {
      log.warn({ err, itemId: input.itemId, imageUrl }, 'eBay image mirror failed (image skipped)')
      return null
    }
  }))
  const rows = mirrored.filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  for (const entry of rows) {
    await prisma.productImage.create({
      data: {
        productId: input.productId,
        mediaAssetId: entry.assetId,
        url: entry.url,
        sourceUrl: entry.sourceUrl,
        altText: `${input.name} - image ${entry.index + 1}`.slice(0, 500),
        label: entry.index === 0 ? 'Main' : null,
        isMain: entry.index === 0,
        sortOrder: entry.index,
      },
    })
  }

  // 4. Final settle for kept rows: eBay's position, main flag, a stamped
  //    sourceUrl (pure-provenance matching from now on) and fresh alt text.
  for (const [index, row] of keptByIndex.entries()) {
    const altText = `${input.name} - image ${index + 1}`.slice(0, 500)
    await prisma.productImage.update({
      where: { id: row.id },
      data: {
        sortOrder: index,
        isMain: index === 0,
        label: index === 0 ? 'Main' : null,
        sourceUrl: row.home,
        ...(row.altText !== altText ? { altText } : {}),
      },
    })
  }

  const mainUrl =
    rows.find((entry) => entry.index === 0)?.url ??
    keptByIndex.get(0)?.url ??
    null

  if (mainUrl && mainUrl !== current?.ogImageUrl) {
    await prisma.product.update({ where: { id: input.productId }, data: { ogImageUrl: mainUrl } })
  } else if (!mainUrl && desired.length === 0 && current?.ogImageUrl) {
    // eBay reports zero photos for the listing: the mirror owns the OG image
    // too, so clear the stale reference instead of leaving it garbage.
    await prisma.product.update({ where: { id: input.productId }, data: { ogImageUrl: null } })
  }

  return { added: rows.length, removed: removeIds.size, mainUrl }
}

/**
 * Full one-way content re-sync of an eBay listing onto its catalog row
 * (mirror scope): display name, description, short description, item
 * specifics, identity fields and the complete photo set.
 *
 * Slug, SKU, website category, brand and SEO title are deliberately NOT
 * overwritten — a listing revision must never move the storefront URL or
 * refund a human's category/SEO decisions. Returns how many things actually
 * changed; the caller logs only real changes so sweeps stay greppable.
 */
export async function syncFullEbayProduct(input: {
  product: {
    id: string
    sku: string
    name: string
    description: string | null
    shortDescription: string | null
    keyFeatures: string[]
    includedItems: string[]
    manufacturer: string | null
    modelNumber: string | null
    mpn: string | null
  }
  details: EbayItemDetails
}): Promise<{ changed: boolean; contentUpdated: boolean; specsUpdated: boolean; imagesAdded: number; imagesRemoved: number }> {
  const { product, details } = input
  const sku = product.sku || normalizeEbaySku(null, details.itemId)

  const plainDescription = htmlToPlainText(details.descriptionHtml)
  const identity = extractIdentity(details.specifics)
  const condition = mapEbayCondition(details.condition)
  const normalized = normalizeProductContent({
    // Same empty-title guard the import path uses: GetItem should always
    // carry a title, but a degenerate listing must not crash normalization.
    name: cleanTitle(details.title) || `eBay item ${details.itemId}`,
    sku,
    condition,
    conditionNotes: details.condition,
    manufacturer: identity.manufacturer,
    modelNumber: identity.modelNumber,
    mpn: identity.mpn,
    description: plainDescription,
    specs: details.specifics,
    categoryName: details.categoryName,
  })

  // Content: only fields that genuinely differ get written.
  const patch = contentPatch(product, normalized)
  if (patch) {
    await prisma.product.update({ where: { id: product.id }, data: patch })
  }

  // Item specifics: replaced wholesale when the (order-sensitive) signature
  // of eBay's spec list differs from the row's specs.
  const existingSpecs = await prisma.productSpec.findMany({
    where: { productId: product.id },
    select: { name: true, value: true },
    orderBy: { sortOrder: 'asc' },
  })

  let specsUpdated = false
  if (specSignature(existingSpecs.map((spec) => ({ name: spec.name, value: spec.value })))
      .join('\n') !== specSignature(normalized.specs).join('\n')) {
    await prisma.productSpec.deleteMany({ where: { productId: product.id } })
    for (const [index, spec] of normalized.specs.entries()) {
      await prisma.productSpec.create({
        data: {
          productId: product.id,
          name: spec.name.slice(0, 255),
          value: spec.value,
          isPublic: true,
          sortOrder: index,
        },
      })
    }
    specsUpdated = true
  }

  // Photos: when the listing carries no picture set, mirrorProductImages
  // handles the "all removed" case itself — pass the empty list through.
  const imageSync = await mirrorProductImages({
    productId: product.id,
    itemId: details.itemId,
    name: normalized.name,
    imageUrls: details.images,
  })

  return {
    changed: Boolean(patch) || specsUpdated || imageSync.added > 0 || imageSync.removed > 0,
    contentUpdated: Boolean(patch),
    specsUpdated,
    imagesAdded: imageSync.added,
    imagesRemoved: imageSync.removed,
  }
}

// Per-job backoff after a rate limit / outage. Kept in memory: a restart
// simply retries immediately, which is harmless.
const pausedUntil = new Map<string, number>()

// Per-job auto-publish tally (kept in memory; the durable record lives in the
// product rows + the per-product audit logs).
const publishedCounts = new Map<string, number>()

/** How many items this job auto-published so far (for sweep summaries). */
export function getAutoPublishedCount(jobId: string): number {
  return publishedCounts.get(jobId) ?? 0
}

async function processJob(job: EbayImportJob): Promise<void> {
  if ((pausedUntil.get(job.id) ?? 0) > Date.now()) return
  pausedUntil.delete(job.id)

  let itemIds = Array.isArray(job.itemIds)
    ? job.itemIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : []
  let total = job.total

  if (itemIds.length === 0) {
    try {
      itemIds = await discoverItemIds(job.marketplace)
    } catch (err) {
      await prisma.ebayImportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          lastError: (err as Error).message.slice(0, 500),
          finishedAt: new Date(),
        },
      })
      log.error({ err, jobId: job.id }, 'eBay import discovery failed')
      return
    }

    // Discovery can take minutes on a large store. If the admin cancelled the
    // job while it was running, do not persist the work list or start importing.
    const current = await prisma.ebayImportJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    })
    if (current?.status !== 'running') {
      log.info({ jobId: job.id, status: current?.status }, 'eBay import stopped after discovery')
      return
    }

    total = itemIds.length
    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: { itemIds, total, cursor: 0 },
    })

    if (total === 0) {
      await prisma.ebayImportJob.update({
        where: { id: job.id },
        data: { status: 'completed', finishedAt: new Date() },
      })
      await logAudit({
        actor: job.createdBy ? { id: job.createdBy, email: 'system', role: 'system' } : undefined,
        action: 'product.import.ebay',
        entityType: 'ebay_import_job',
        entityId: job.id,
        newValue: { marketplace: job.marketplace, total: 0, created: 0, linked: 0, skipped: 0, failed: 0 },
      })
      return
    }
  }

  // A cancel can land between scheduler ticks / during a pause.
  const freshStatus = await prisma.ebayImportJob.findUnique({
    where: { id: job.id },
    select: { status: true },
  })
  if (freshStatus?.status !== 'running') return

  const lookup = await loadLookup()
  const existingSeoTitles = await prisma.product.findMany({
    where: { seoTitle: { not: null } },
    select: { seoTitle: true },
  })
  const usedSeoTitles = new Set(
    existingSeoTitles
      .map((product) => product.seoTitle?.trim().toLowerCase())
      .filter((title): title is string => Boolean(title)),
  )
  let cursor = Math.min(job.cursor, total)
  const end = Math.min(total, cursor + batchSize())
  const counts = {
    processed: job.processed,
    created: job.created,
    linked: job.linked,
    skipped: job.skipped,
    failed: job.failed,
  }
  let lastError = job.lastError

  for (; cursor < end; cursor += 1) {
    const itemId = itemIds[cursor]
    if (!itemId) {
      counts.skipped += 1
      counts.processed += 1
      continue
    }

    try {
      const outcome = await importOne(itemId, job.marketplace, job.id, lookup, job.createdBy, usedSeoTitles)
      counts[outcome] += 1
    } catch (err) {
      // A rate limit / eBay outage must not burn through the remaining item
      // list marking every row failed. Abort this batch without advancing the
      // cursor; the next scheduler tick retries the same item.
      if (isTransientImportError(err)) {
        const message = (err as Error).message.slice(0, 480)
        await prisma.ebayImportJob.update({
          where: { id: job.id },
          data: { lastError: `Paused on item ${itemId}: ${message}`.slice(0, 500) },
        })
        pausedUntil.set(job.id, Date.now() + 60_000)
        log.warn({ err, itemId, jobId: job.id }, 'eBay import paused on a transient error — retrying this cursor in 60s')
        throw err
      }
      counts.failed += 1
      lastError = (err as Error).message.slice(0, 500)
      log.warn({ err, itemId, jobId: job.id }, 'eBay import item failed')
    }
    counts.processed += 1

    // Persist after every item so a restart resumes at the exact cursor.
    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: { cursor: cursor + 1, ...counts, lastError },
    })

    const fresh = await prisma.ebayImportJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    })
    if (fresh?.status === 'cancelled') {
      log.info({ jobId: job.id, cursor: cursor + 1 }, 'eBay import cancelled')
      return
    }
  }

  if (cursor >= total) {
    await prisma.ebayImportJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        cursor,
        ...counts,
        // A transient pause that recovered should not leave a scary error on
        // a fully successful job.
        lastError: counts.failed > 0 ? lastError : null,
      },
    })
    await logAudit({
      actor: job.createdBy ? { id: job.createdBy, email: 'system', role: 'system' } : undefined,
      action: 'product.import.ebay',
      entityType: 'ebay_import_job',
      entityId: job.id,
      newValue: { marketplace: job.marketplace, total, ...counts },
    })
    log.info({ jobId: job.id, total, ...counts }, 'eBay catalog import completed')
  }
}

let running = false

/** One bounded batch. Safe to call from an event or queued-work timer. */
export async function processEbayImportJobs(): Promise<void> {
  if (running) return
  running = true
  let hasMoreWork = false
  try {
    let job = await prisma.ebayImportJob.findFirst({
      where: { status: 'running' },
      orderBy: { updatedAt: 'asc' },
    })
    if (!job) {
      const queued = await prisma.ebayImportJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      })
      if (!queued) return
      job = await prisma.ebayImportJob.update({
        where: { id: queued.id },
        data: { status: 'running', startedAt: queued.startedAt ?? new Date() },
      })
    }
    await processJob(job)
    const remaining = await prisma.ebayImportJob.findFirst({
      where: { status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    hasMoreWork = Boolean(remaining)
  } catch (err) {
    log.error({ err }, 'eBay catalog import tick failed')
  } finally {
    running = false
    if (hasMoreWork) scheduleNextImportBatch()
    else if (schedulerStarted) {
      // A transient failure or a rate-limit pause may leave the job active.
      // Schedule a retry without waking the process when the queue is idle.
      const pending = await prisma.ebayImportJob.findFirst({
        where: { status: { in: ['queued', 'running'] } },
        select: { id: true },
      }).catch((err) => {
        log.error({ err }, 'eBay import retry check failed')
        return null
      })
      if (pending) scheduleNextImportBatch()
    }
  }
}

// ─── Work-driven queue runner ──────────────────────────────────

const DEFAULT_INTERVAL_MS = 5_000
let nextBatch: ReturnType<typeof setTimeout> | null = null
let schedulerStarted = false

function scheduleNextImportBatch(): void {
  if (!schedulerStarted || nextBatch || running) return
  nextBatch = setTimeout(() => {
    nextBatch = null
    void processEbayImportJobs()
  }, DEFAULT_INTERVAL_MS)
  nextBatch.unref?.()
}

export function startEbayCatalogImportScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (schedulerStarted) return
  schedulerStarted = true
  const cadence = Number.isFinite(intervalMs) ? Math.max(1_000, Math.floor(intervalMs)) : DEFAULT_INTERVAL_MS
  const delay = cadence === DEFAULT_INTERVAL_MS ? 1 : cadence
  void prisma.ebayImportJob.findFirst({
    where: { status: { in: ['queued', 'running'] } },
    select: { id: true },
  }).then((pending) => {
    if (!pending || !schedulerStarted) return
    nextBatch = setTimeout(() => {
      nextBatch = null
      void processEbayImportJobs()
    }, delay)
    nextBatch.unref?.()
  }).catch((err) => log.error({ err }, 'eBay import startup recovery check failed'))
  log.info({ intervalMs: cadence, idlePolling: false }, 'eBay catalog import queue runner started')
}

export function stopEbayCatalogImportScheduler() {
  schedulerStarted = false
  if (nextBatch) { clearTimeout(nextBatch); nextBatch = null }
}
