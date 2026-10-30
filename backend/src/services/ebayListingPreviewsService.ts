/**
 * eBay Listing previews (GraphQL Inventory Mapping API) — orchestration.
 *
 * The modernized GraphQL gateway lets a seller submit "external products"
 * (their own SKU/title/images/aspects) as an asynchronous batch task and get
 * back LISTING PREVIEWS: eBay's recommended category, product aspects with
 * PREFILL/HINT confidence, ePID catalog match, and suggested title. This is
 * the recommendation layer `ebayListingService` was missing — today the admin
 * hand-types a numeric eBay category id and only Brand/MPN aspects are sent,
 * so eBay frequently rejects publish with "category requires extra aspects".
 *
 * Flow (see docs/ebay-listing-previews.md):
 *   POST /admin/ebay/listing-previews/run
 *     → buildExternalProductDetails() per published product
 *     → startListingPreviewsCreation mutation → eBay task id → task row
 *   GET /admin/ebay/listing-previews/tasks/:id   (the Hub UI polls ~3 s)
 *     → live-poll listingPreviewsCreationTaskById once per call
 *     → completed: applyTaskResult() flattens previews into
 *       ebay_listing_previews rows (category id, ePID, PREFILL aspects)
 *   "List on eBay" without a typed category id:
 *     → ebayListingService uses getLatestSuggestedPreview() and enriches the
 *       inventory item with the PREFILL aspects (pure helpers in
 *       ebayListingPreviewsPure.ts).
 *
 * GraphQL documents live in the constants below, mirroring the documented
 * schema (developer.ebay.com → sell/inventory_mapping). Field names INSIDE
 * externalProducts / previews / task results are taken verbatim from the
 * listingPreviewsCreationTaskById page; if eBay revises the wrapper names,
 * the two document constants are the only place to adjust. A wrong field name
 * surfaces as a GraphQL validation error naming the culprit field — fast to
 * fix in one place.
 */
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { graphqlFetch, isEbayConfigured } from './ebayClient.js'
import {
  truncateTitle,
  buildExternalProductDetails,
  recommendedCategoryId,
  completionStatusToTaskStatus,
  MAX_EXTERNAL_PRODUCTS,
  type ListingPreview,
  type PreviewAspects,
} from './ebayListingPreviewsPure.js'

const log = logger.child({ context: 'ebay-listing-previews' })

// ─── GraphQL documents ─────────────────────────────────────────

const LISTING_PREVIEWS_MUTATION = `mutation startListingPreviewsCreation ($input: StartListingPreviewsCreationInput!) {
  startListingPreviewsCreation (input: $input) {
    listingPreviewsCreationTask {
      id
    }
    errors {
      errorDescription
    }
  }
}`

const LISTING_PREVIEWS_TASK_QUERY = `query listingPreviewsCreationTaskById ($input: ListingPreviewsCreationTaskByIdInput!) {
  listingPreviewsCreationTaskById (input: $input) {
    requestedId
    listingPreviewsCreationTask {
      id
      result {
        completionStatus
        listingPreviews {
          sku
          title
          description
          mappingReferenceId
          category {
            id
            categoryId
            level
            name
          }
          images
          product {
            epid
          }
          aspects {
            name
            aspectValues
            values {
              value
              confidence
            }
          }
          clientProvidedProductDetails {
            sku
            title
          }
        }
        unprocessedProducts {
          sku
          title
        }
        unmappedProducts {
          sku
          title
        }
        invalidProducts {
          clientProvidedProductDetails {
            sku
            title
          }
          description
        }
      }
    }
  }
}`

// ─── Types (gateway responses) ─────────────────────────────────

export type { ExternalProductDetails, ProductForPreview, ListingPreview, PreviewAspects } from './ebayListingPreviewsPure.js'
export {
  MAX_EXTERNAL_PRODUCTS, EBAY_TITLE_CAP, truncateTitle, buildExternalProductDetails,
  mergeAspectRecommendations, recommendedCategoryId, completionStatusToTaskStatus,
} from './ebayListingPreviewsPure.js'

export interface ListingPreviewsTaskResult {
  completionStatus?: string | null
  listingPreviews?: ListingPreview[] | null
  unprocessedProducts?: Array<{ sku?: string | null; title?: string | null }> | null
  unmappedProducts?: Array<{ sku?: string | null; title?: string | null }> | null
  invalidProducts?: Array<{
    clientProvidedProductDetails?: { sku?: string | null; title?: string | null } | null
    description?: string | null
  }> | null
}

interface StartListingPreviewsCreationResponse {
  startListingPreviewsCreation?: {
    listingPreviewsCreationTask?: { id?: string | null } | null
    /** Null per the docs when the mutation ran clean; errorDescription is a
     *  human-oriented debugging aid — never a machine-readable signal. */
    errors?: Array<{ errorDescription?: string | null } | null> | null
  } | null
}

interface ListingPreviewsTaskByIdResponse {
  listingPreviewsCreationTaskById?: {
    requestedId?: string | null
    listingPreviewsCreationTask?: {
      id: string
      result?: ListingPreviewsTaskResult | null
    } | null
  } | null
}

// ─── Task orchestration ────────────────────────────────────────

export interface StartListingPreviewsTaskInput {
  productIds?: string[]
  marketplace?: string
}

/**
 * Start an eBay listingPreviewsCreation task for products we plan to list.
 * Default scope: published products with NO live eBay listing yet — the
 * "what should I list next?" flow the Hub needs. Explicit productIds are
 * honoured (deduped by the query, capped MAX_EXTERNAL_PRODUCTS).
 */
export async function startListingPreviewsTask(input: StartListingPreviewsTaskInput, actorId: string) {
  if (!isEbayConfigured()) {
    throw Object.assign(new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'), { status: 503 })
  }
  const marketplace = (input.marketplace || 'EBAY_US').toUpperCase()

  const where = input.productIds?.length
    ? { id: { in: input.productIds }, status: 'published' as const }
    : {
        status: 'published' as const,
        ebayListings: { none: { status: { in: ['pending', 'published', 'sync-pending', 'synced'] } } },
      }

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true, sku: true, name: true, manufacturer: true, mpn: true,
      // Three ancestor levels back the breadcrumb path for categoryName
      // ("/Parent/…/Leaf" is the documented path form); deeper trees just
      // degrade to the leaf name, which the API also accepts.
      category: {
        select: { name: true, parent: { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } } },
      },
      images: { orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }], select: { url: true } },
    },
    take: MAX_EXTERNAL_PRODUCTS,
    orderBy: { updatedAt: 'desc' },
  })

  if (products.length === 0) {
    throw Object.assign(new Error('No published products matched the listing-preview scope'), { status: 404 })
  }

  const externals = products.map((product) =>
    buildExternalProductDetails(product, product.images.map((image) => image.url)),
  )

  const response = await graphqlFetch<StartListingPreviewsCreationResponse>(
    LISTING_PREVIEWS_MUTATION,
    { input: { externalProducts: externals } },
    'startListingPreviewsCreation',
  )
  const mutationBody = response?.startListingPreviewsCreation
  const ebayTaskId = mutationBody?.listingPreviewsCreationTask?.id
  if (!ebayTaskId) {
    // Doc: the task object "will only be null when there is a server error
    // prior to starting the preview creation process". Mutation-level errors
    // (validation etc.) surface with their errorDescription lines; note these
    // strings are documented debugging aids, not stable error codes.
    const descriptions = (mutationBody?.errors || [])
      .filter(Boolean)
      .map((e) => String(e?.errorDescription || '').trim())
      .filter(Boolean)
    const detail = descriptions.length > 0 ? descriptions.join(' | ') : JSON.stringify(response).slice(0, 300)
    throw Object.assign(
      new Error(`eBay startListingPreviewsCreation returned no task id: ${detail}`),
      { status: 502 },
    )
  }

  const task = await prisma.ebayListingPreviewTask.create({
    data: {
      ebayTaskId: String(ebayTaskId),
      marketplace,
      status: 'running',
      productIds: products.map((product) => product.id),
      total: products.length,
      createdBy: actorId,
      startedAt: new Date(),
    },
  })

  log.info({ taskId: ebayTaskId, products: products.length, marketplace, actorId }, 'eBay listing previews task started')
  return task
}

/**
 * Poll one task row's eBay state ONCE (the Hub UI polls every few seconds;
 * this stays stateless and restart-safe, and the documented "task may still
 * be running → null result" case simply leaves the row 'running').
 * Completed results are flattened into ebay_listing_previews rows.
 */
export async function pollListingPreviewsTask(taskId: string) {
  const task = await prisma.ebayListingPreviewTask.findUnique({ where: { id: taskId } })
  if (!task) return null
  if (task.status !== 'running') return task

  const response = await graphqlFetch<ListingPreviewsTaskByIdResponse>(
    LISTING_PREVIEWS_TASK_QUERY,
    { input: { id: task.ebayTaskId } },
    'listingPreviewsCreationTaskById',
  )

  const result = response?.listingPreviewsCreationTaskById?.listingPreviewsCreationTask?.result
  if (!result?.completionStatus) return task // still processing at eBay

  return applyTaskResult(task, result)
}

/**
 * Flatten a completed task result into preview rows. Idempotent: reapplying
 * overwrites the same (taskId, productId) row via the compound unique key.
 */
export async function applyTaskResult(
  task: { id: string; ebayTaskId: string; productIds: unknown; marketplace: string },
  result: ListingPreviewsTaskResult,
) {
  // sku → productId for this task's work list.
  const productIdBySku = new Map<string, string>()
  if (Array.isArray(task.productIds)) {
    const ids = (task.productIds as unknown[]).filter((id): id is string => typeof id === 'string')
    if (ids.length > 0) {
      const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true } })
      for (const row of rows) productIdBySku.set(row.sku, row.id)
    }
  }

  const resolveProductId = (sku: string | null | undefined): string | null => {
    const key = String(sku || '').trim()
    return key ? (productIdBySku.get(key) ?? null) : null
  }

  let created = 0
  let unprocessed = 0
  let unmapped = 0
  let invalid = 0

  for (const preview of result.listingPreviews || []) {
    const productId = resolveProductId(preview.sku || preview.clientProvidedProductDetails?.sku)
    if (!productId) continue
    const payload = {
      taskId: task.ebayTaskId,
      marketplace: task.marketplace,
      status: 'suggested',
      categoryId: preview.category?.categoryId || preview.category?.id || null,
      categoryLevel: typeof preview.category?.level === 'number' ? preview.category.level : null,
      categoryName: preview.category?.name || null,
      epid: preview.product?.epid || null,
      // eBay asks sellers to reference this 25-char id when creating/revision
      // listings built from the preview; our REST publish flow has no field
      // for it, so it is stored for diagnostics until the REST listing APIs
      // expose it (see MANUAL_TASKS MT-24).
      mappingReferenceId: preview.mappingReferenceId || null,
      suggestedTitle: truncateTitle(preview.title || preview.clientProvidedProductDetails?.title || ''),
      aspects: preview.aspects ?? undefined,
      outcome: 'ok' as const,
      reason: null as string | null,
      response: preview as object,
    }
    if (!payload.categoryId && !payload.epid) {
      // eBay processed the product but returned nothing usable to prefill —
      // keep the row (the admin sees the outcome) but don't call it created.
      payload.reason = 'no category or ePID recommendation returned'
    } else {
      created += 1
    }
    await prisma.ebayListingPreview.upsert({
      where: { taskId_productId: { taskId: task.ebayTaskId, productId } },
      create: { ...payload, productId },
      update: payload,
    })
  }

  for (const entry of result.unprocessedProducts || []) {
    const productId = resolveProductId(entry.sku)
    if (!productId) continue
    unprocessed += 1
    await upsertNonPreviewRow(task, productId, 'unprocessed', entry.title)
  }
  for (const entry of result.unmappedProducts || []) {
    const productId = resolveProductId(entry.sku)
    if (!productId) continue
    unmapped += 1
    await upsertNonPreviewRow(task, productId, 'unmapped', entry.title)
  }
  for (const entry of result.invalidProducts || []) {
    const productId = resolveProductId(entry.clientProvidedProductDetails?.sku)
    if (!productId) continue
    invalid += 1
    await upsertNonPreviewRow(task, productId, 'invalid', entry.clientProvidedProductDetails?.title, entry.description || undefined)
  }

  const status = completionStatusToTaskStatus(result.completionStatus)
  const updated = await prisma.ebayListingPreviewTask.update({
    where: { id: task.id },
    data: {
      status,
      created,
      unprocessed,
      unmapped,
      invalid,
      lastError: status === 'failed' ? 'eBay reported the preview task as failed' : null,
      finishedAt: status === 'running' ? null : new Date(),
    },
  })

  log.info({ taskId: task.ebayTaskId, status, created, unprocessed, unmapped, invalid }, 'eBay listing previews task result applied')
  return updated
}

async function upsertNonPreviewRow(
  task: { id: string; ebayTaskId: string; marketplace: string },
  productId: string,
  outcome: string,
  title: string | null | undefined,
  reason?: string,
) {
  const payload = {
    taskId: task.ebayTaskId,
    marketplace: task.marketplace,
    status: 'suggested',
    categoryId: null,
    categoryLevel: null,
    categoryName: null,
    epid: null,
    mappingReferenceId: null,
    suggestedTitle: truncateTitle(title || ''),
    aspects: undefined,
    outcome,
    reason: reason || null,
    response: undefined,
  }
  await prisma.ebayListingPreview.upsert({
    where: { taskId_productId: { taskId: task.ebayTaskId, productId } },
    create: { ...payload, productId },
    update: payload,
  })
}

// ─── Consumption by the listing service ────────────────────────

export interface SuggestedPreview {
  productId: string
  categoryId: string
  epid: string | null
  /** eBay-recommended aspects in ListingPreview shape (for merging). */
  recommendedAspects: PreviewAspects
  /** Local row id, so consumers can flag the suggestion as applied. */
  rowId: string
}

/**
 * Latest usable suggestion for one product: the newest 'ok' preview with a
 * category id. `null` when there is none — the admin keeps supplying the
 * category id manually, exactly as before.
 */
export async function getLatestSuggestedPreview(productId: string): Promise<SuggestedPreview | null> {
  const preview = await prisma.ebayListingPreview.findFirst({
    where: { productId, outcome: 'ok' },
    orderBy: { createdAt: 'desc' },
  })
  if (!preview) return null
  const categoryId = recommendedCategoryId({ categoryId: preview.categoryId, response: preview.response })
  if (!categoryId) return null
  return {
    rowId: preview.id,
    productId,
    categoryId,
    epid: preview.epid,
    recommendedAspects: (Array.isArray(preview.aspects) ? preview.aspects : []) as PreviewAspects,
  }
}

/** Mark a preview consumed by a listing creation (best-effort bookkeeping). */
export async function markListingPreviewApplied(rowId: string): Promise<void> {
  await prisma.ebayListingPreview.update({
    where: { id: rowId },
    data: { status: 'applied' },
  }).catch((err) => {
    log.warn({ err, rowId }, 'failed to mark listing preview applied')
  })
}
