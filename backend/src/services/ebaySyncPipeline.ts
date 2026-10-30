/**
 * Central-stock → eBay quantity pipeline.
 *
 * Extracted from ebaySyncScheduler (roadmap C) so the whole website→eBay
 * direction is testable without booting the HTTP app or a database: the
 * pipeline receives its storage and its eBay API calls as dependencies
 * (EbaySyncPipelineDeps). The scheduler supplies the real Prisma client and
 * the Inventory/Trading API clients; the integration tests supply an
 * in-memory Prisma-shaped mock and a recording Trading API mock.
 *
 * Semantics are unchanged and remain the single definition used by the timed
 * sweep, the event-driven kick and the eBay Hub "Push qty" action:
 *   - central stock is authoritative; a failed push NEVER rolls stock back
 *   - only an ARCHIVED product ends the relationship (drafts/hidden keep
 *     converging, otherwise a pre-publish sale leaves stale stock on eBay)
 *   - an offer id (Inventory API) wins; otherwise the Trading API ItemID is
 *     used for listings imported from the eBay UI
 *   - multi-variation listings are marked synced with the central snapshot:
 *     eBay owns per-variation quantity, so retrying the item-level push would
 *     loop forever
 *   - retryable failures leave the row 'sync-pending' (next sweep retries);
 *     permanent validation failures become 'sync-failed' for the admin
 *   - paused rows (syncDisabled) are never pushed and never re-enqueued
 */
/** Fields a sync step may write back onto a mirror row. */
export interface EbayListingUpdate {
  status?: string
  lastSyncedQty?: number | null
  lastSyncAt?: Date | null
  lastError?: string | null
}

/** Minimal shape every pipeline step needs from a mirror row. */
export interface EbayListingSnapshot {
  id: string
  sku: string
  marketplace: string
  status: string
  ebayOfferId: string | null
  ebayListingId: string | null
  syncDisabled: boolean
  lastSyncedQty: number | null
  product: { stockCount: number; status: string; sku: string }
}

/** Storage the pipeline needs (implemented over prisma.ebayListing). */
export interface EbaySyncStore {
  /** Rows awaiting a website → eBay push (paused rows excluded by the query). */
  pendingListings(limit: number): Promise<EbayListingSnapshot[]>
  /** Rows eligible for drift reconciliation (paused rows excluded). */
  activeListings(): Promise<EbayListingSnapshot[]>
  /** One row, used by the admin "push now" action. */
  listing(id: string): Promise<EbayListingSnapshot | null>
  updateListing(id: string, data: EbayListingUpdate): Promise<void>
}

/** The two eBay write channels a quantity can travel over. */
export interface EbaySyncApis {
  /** Inventory API offer quantity (app-created listings). */
  setOfferQuantity(offerId: string, quantity: number): Promise<void>
  /** Trading API ReviseInventoryStatus (listings created outside the app). */
  reviseTradingQuantity(itemId: string, quantity: number): Promise<void>
}

export interface EbaySyncPipelineDeps {
  store: EbaySyncStore
  apis: EbaySyncApis
  /** Same retry classification the scheduler uses (see ebayClient). */
  isRetryable(error: unknown): boolean
  now?(): Date
  log?(level: 'info' | 'warn', data: Record<string, unknown>, message: string): void
}

export type PushOutcome = 'synced' | 'skipped' | 'failed'

/** Rows pushed per sweep (mirrors the scheduler's historical batch size). */
export const PUSH_BATCH_SIZE = 50

function now(deps: EbaySyncPipelineDeps): Date {
  return deps.now ? deps.now() : new Date()
}

function log(deps: EbaySyncPipelineDeps, level: 'info' | 'warn', data: Record<string, unknown>, message: string): void {
  deps.log?.(level, data, message)
}

/**
 * Push one listing's central quantity to eBay.
 * Returns 'skipped' when there is nothing to push (archived product, no
 * identifier, multi-variation listing) — those rows are already settled.
 */
export async function pushListingQuantity(
  deps: EbaySyncPipelineDeps,
  listing: EbayListingSnapshot,
): Promise<PushOutcome> {
  // Only ARCHIVING ends the relationship. Draft/hidden products with a managed
  // eBay listing keep selling there, so their central stock must keep
  // converging — otherwise the first post-publish push resurrects sold units.
  if (listing.product.status === 'archived') {
    await deps.store.updateListing(listing.id, {
      status: 'sync-failed',
      lastError: 'product archived — end the eBay listing',
    })
    return 'skipped'
  }

  const centralQty = listing.product.stockCount
  const offerId = listing.ebayOfferId
  const tradingItemId = listing.ebayListingId
  if (!offerId && !tradingItemId) {
    await deps.store.updateListing(listing.id, {
      status: 'sync-failed',
      lastError: 'no eBay offer id or item id stored — cannot push quantity',
    })
    return 'skipped'
  }

  try {
    if (offerId) await deps.apis.setOfferQuantity(offerId, centralQty)
    else await deps.apis.reviseTradingQuantity(tradingItemId as string, centralQty)

    await deps.store.updateListing(listing.id, {
      status: 'synced',
      lastSyncedQty: centralQty,
      lastSyncAt: now(deps),
      lastError: null,
    })
    log(deps, 'info', { sku: listing.sku, offerId, itemId: tradingItemId, qty: centralQty }, 'eBay quantity synced')
    return 'synced'
  } catch (err) {
    const message = (err as Error).message

    // Multi-variation listings reject item-level quantity pushes — eBay owns
    // the per-variation quantities. Mark the row synced with the central
    // snapshot so neither the push nor the reconcile job loops on it.
    if (/variation/i.test(message)) {
      await deps.store.updateListing(listing.id, {
        status: 'synced',
        lastSyncedQty: centralQty,
        lastSyncAt: now(deps),
        lastError: null,
      })
      log(
        deps,
        'warn',
        { sku: listing.sku, offerId, itemId: tradingItemId, qty: centralQty },
        'eBay multi-variation listing — item-level quantity push skipped (per-variation quantities live on eBay)',
      )
      return 'skipped'
    }

    // NEVER roll back central stock because eBay failed (spec).
    const retryable = deps.isRetryable(err)
    await deps.store.updateListing(listing.id, {
      status: retryable ? 'sync-pending' : 'sync-failed',
      lastError: message.slice(0, 500),
    })
    log(deps, 'warn', { err, sku: listing.sku, retryable }, 'eBay quantity sync failed (central stock unchanged)')
    return 'failed'
  }
}

/** One bounded pass over the rows marked 'sync-pending'. */
export async function syncPendingQuantities(
  deps: EbaySyncPipelineDeps,
  options: { batchSize?: number } = {},
): Promise<{ synced: number; failed: number; skipped: number }> {
  const result = { synced: 0, failed: 0, skipped: 0 }
  const listings = await deps.store.pendingListings(options.batchSize ?? PUSH_BATCH_SIZE)
  for (const listing of listings) {
    const outcome = await pushListingQuantity(deps, listing)
    result[outcome] += 1
  }
  return result
}

/**
 * Detect drift between central stock and the last pushed quantity and
 * re-enqueue those rows. Paused rows never re-enqueue; archived products are
 * left alone (archiving ends the relationship).
 */
export async function reconcileQuantities(deps: EbaySyncPipelineDeps): Promise<number> {
  const active = await deps.store.activeListings()
  let drifted = 0
  for (const listing of active) {
    if (listing.product.status === 'archived') continue
    const central = listing.product.stockCount
    if (listing.lastSyncedQty !== central) {
      await deps.store.updateListing(listing.id, {
        status: 'sync-pending',
        lastError: `reconciliation: central=${central} lastSynced=${listing.lastSyncedQty ?? 'never'}`,
      })
      drifted += 1
    }
  }
  return drifted
}

/**
 * eBay Hub action: push ONE listing's central quantity immediately. Reads the
 * row fresh so the admin always acts on current state; paused or missing rows
 * are refused with a human-readable message.
 */
export async function pushListingNow(
  deps: EbaySyncPipelineDeps,
  listingId: string,
): Promise<{ ok: boolean; message: string }> {
  const listing = await deps.store.listing(listingId)
  if (!listing) return { ok: false, message: 'eBay listing not found' }
  if (listing.syncDisabled) {
    return { ok: false, message: 'Listing is paused in the eBay Hub — resume it before pushing quantity' }
  }

  const outcome = await pushListingQuantity(deps, listing)
  if (outcome === 'synced') {
    return { ok: true, message: `Quantity pushed to eBay (central stock ${listing.product.stockCount})` }
  }
  if (outcome === 'skipped') return { ok: false, message: 'Push skipped — see the sync status on this row' }
  return { ok: false, message: 'Push failed — the error is recorded on the listing row' }
}
