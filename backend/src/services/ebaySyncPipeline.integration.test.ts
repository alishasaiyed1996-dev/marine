/**
 * eBay sync pipeline integration tests.
 * Run: cd backend && npx tsx --test src/services/ebaySyncPipeline.integration.test.ts
 *
 * The pipeline is exercised end-to-end through its real code path
 * (ebaySyncPipeline.ts) with:
 *   - a MOCKED PRISMA CLIENT: an in-memory `ebayListing` delegate that
 *     implements the where/take/update semantics the scheduler relies on, so
 *     the pipeline's queries and write-backs are observed, not assumed;
 *   - a MOCKED TRADING API (and Inventory API): recording stubs standing in
 *     for ReviseInventoryStatus / offer quantity, which can fail on demand.
 *
 * Covered behaviour is exactly the contract the scheduler promises: central
 * stock is authoritative, no rollback on failure, offer id before item id,
 * paused rows never pushed, archived rows never pushed, variation listings
 * settled instead of retry-looped, retryable vs permanent failure statuses,
 * and drift reconciliation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PUSH_BATCH_SIZE,
  pushListingNow,
  reconcileQuantities,
  syncPendingQuantities,
  type EbayListingSnapshot,
  type EbayListingUpdate,
  type EbaySyncApis,
  type EbaySyncPipelineDeps,
  type EbaySyncStore,
} from './ebaySyncPipeline.js'

type MirrorRow = EbayListingSnapshot

function mirrorRow(overrides: Partial<MirrorRow> & Pick<MirrorRow, 'id' | 'sku'>): MirrorRow {
  const { product, ...rest } = overrides
  return {
    marketplace: 'EBAY_US',
    status: 'sync-pending',
    ebayOfferId: null,
    ebayListingId: null,
    syncDisabled: false,
    lastSyncedQty: null,
    ...rest,
    product: product ?? { stockCount: 0, status: 'published', sku: overrides.sku },
  }
}

/**
 * In-memory stand-in for prisma.ebayListing. Only the query surface the
 * pipeline uses is implemented, and every write is recorded so tests can
 * assert on the exact status/quantity/error written back.
 */
function createMockPrisma(seed: MirrorRow[]) {
  const table = new Map(seed.map((entry) => [entry.id, structuredClone(entry)]))
  const updates: Array<{ id: string; data: EbayListingUpdate }> = []
  const queries: Array<Record<string, unknown>> = []

  const ebayListing = {
    async findMany(args: { where?: Record<string, any>; take?: number }) {
      queries.push(args)
      const where = args.where ?? {}
      const statuses: string[] | undefined = Array.isArray(where.status?.in) ? where.status.in : undefined
      return [...table.values()]
        .filter((entry) => (statuses ? statuses.includes(entry.status) : where.status ? entry.status === where.status : true))
        .filter((entry) => (typeof where.syncDisabled === 'boolean' ? entry.syncDisabled === where.syncDisabled : true))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, args.take ?? Number.POSITIVE_INFINITY)
        .map((entry) => structuredClone(entry))
    },
    async findUnique(args: { where: { id: string } }) {
      queries.push(args)
      const entry = table.get(args.where.id)
      return entry ? structuredClone(entry) : null
    },
    async update(args: { where: { id: string }; data: EbayListingUpdate }) {
      const entry = table.get(args.where.id)
      assert.ok(entry, `mock prisma: update of unknown listing ${args.where.id}`)
      updates.push({ id: args.where.id, data: args.data })
      table.set(args.where.id, { ...entry, ...(args.data as Partial<MirrorRow>) })
      return structuredClone(table.get(args.where.id))
    },
  }

  const store: EbaySyncStore = {
    pendingListings: (limit) =>
      ebayListing.findMany({ where: { status: 'sync-pending', syncDisabled: false }, take: limit }),
    activeListings: () =>
      ebayListing.findMany({
        where: { status: { in: ['synced', 'published', 'sync-failed'] }, syncDisabled: false },
      }),
    listing: (id) => ebayListing.findUnique({ where: { id } }),
    updateListing: async (id, data) => { await ebayListing.update({ where: { id }, data }) },
  }

  return { store, table, updates, queries }
}

type ApiCall = { channel: 'offer' | 'trading'; id: string; quantity: number }

/** Mocked Trading + Inventory API writes. */
function createMockEbayApis(options: { offerError?: Error; tradingError?: Error } = {}) {
  const calls: ApiCall[] = []
  const apis: EbaySyncApis = {
    async setOfferQuantity(offerId, quantity) {
      calls.push({ channel: 'offer', id: offerId, quantity })
      if (options.offerError) throw options.offerError
    },
    async reviseTradingQuantity(itemId, quantity) {
      calls.push({ channel: 'trading', id: itemId, quantity })
      if (options.tradingError) throw options.tradingError
    },
  }
  return { apis, calls }
}

const FIXED_NOW = new Date('2026-10-30T10:00:00.000Z')

function depsFor(
  store: EbaySyncStore,
  apis: EbaySyncApis,
  overrides: Partial<EbaySyncPipelineDeps> = {},
): EbaySyncPipelineDeps {
  return {
    store,
    apis,
    // Same classification as ebayClient.isRetryableError, kept explicit so the
    // retry/permanent split is asserted rather than imported.
    isRetryable: (err) => /\((5\d\d|429)\)|ETIMEDOUT|ECONNRESET|fetch failed/.test((err as Error).message),
    now: () => FIXED_NOW,
    ...overrides,
  }
}

// ─── push path ─────────────────────────────────────────────────

test('push: offer id wins and the row records the pushed central quantity', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-offer',
      sku: 'SKU-OFFER',
      ebayOfferId: 'OFFER-1',
      ebayListingId: 'ITEM-1',
      lastSyncedQty: 2,
      product: { stockCount: 7, status: 'published', sku: 'SKU-OFFER' },
    }),
  ])
  const ebay = createMockEbayApis()

  assert.deepEqual(
    await syncPendingQuantities(depsFor(prisma.store, ebay.apis)),
    { synced: 1, failed: 0, skipped: 0 },
  )

  // Inventory API only — the offer path must never also hit the Trading API.
  assert.deepEqual(ebay.calls, [{ channel: 'offer', id: 'OFFER-1', quantity: 7 }])
  const row = prisma.table.get('row-offer')!
  assert.equal(row.status, 'synced')
  assert.equal(row.lastSyncedQty, 7)
  assert.equal((row as unknown as { lastSyncAt: Date }).lastSyncAt.toISOString(), FIXED_NOW.toISOString())
  assert.equal(prisma.updates.at(-1)?.data.lastError, null)
})

test('push: imported listings without an offer id go through the Trading API', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-trading',
      sku: 'SKU-IMPORTED',
      ebayListingId: '1234567890',
      product: { stockCount: 3, status: 'draft', sku: 'SKU-IMPORTED' },
    }),
  ])
  const ebay = createMockEbayApis()

  await syncPendingQuantities(depsFor(prisma.store, ebay.apis))

  assert.deepEqual(ebay.calls, [{ channel: 'trading', id: '1234567890', quantity: 3 }])
  assert.equal(prisma.table.get('row-trading')!.status, 'synced')
  // Drafts keep selling on eBay, so their stock must keep converging.
  assert.equal(prisma.table.get('row-trading')!.lastSyncedQty, 3)
})

test('push: out-of-stock products still push quantity 0 (zero is a real value)', async () => {
  const prisma = createMockPrisma([
    mirrorRow({ id: 'row-zero', sku: 'SKU-ZERO', ebayOfferId: 'OFFER-0' }),
  ])
  const ebay = createMockEbayApis()

  await syncPendingQuantities(depsFor(prisma.store, ebay.apis))

  assert.deepEqual(ebay.calls, [{ channel: 'offer', id: 'OFFER-0', quantity: 0 }])
  assert.equal(prisma.table.get('row-zero')!.lastSyncedQty, 0)
})

test('push: paused rows are never selected and "push now" refuses them', async () => {
  const prisma = createMockPrisma([
    mirrorRow({ id: 'row-paused', sku: 'SKU-PAUSED', ebayOfferId: 'OFFER-P', syncDisabled: true }),
  ])
  const ebay = createMockEbayApis()
  const deps = depsFor(prisma.store, ebay.apis)

  assert.deepEqual(await syncPendingQuantities(deps), { synced: 0, failed: 0, skipped: 0 })
  assert.deepEqual(ebay.calls, [])

  const result = await pushListingNow(deps, 'row-paused')
  assert.equal(result.ok, false)
  assert.match(result.message, /paused/i)
  assert.deepEqual(ebay.calls, [])
})

test('push: an archived product is skipped with a reason and never called', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-archived',
      sku: 'SKU-ARCHIVED',
      ebayOfferId: 'OFFER-A',
      product: { stockCount: 5, status: 'archived', sku: 'SKU-ARCHIVED' },
    }),
  ])
  const ebay = createMockEbayApis()

  assert.equal((await syncPendingQuantities(depsFor(prisma.store, ebay.apis))).skipped, 1)
  assert.deepEqual(ebay.calls, [])
  const row = prisma.table.get('row-archived')!
  assert.equal(row.status, 'sync-failed')
  assert.match((row as unknown as { lastError: string }).lastError, /archived/)
})

test('push: a row with no offer id and no item id fails loudly instead of guessing', async () => {
  const prisma = createMockPrisma([mirrorRow({ id: 'row-empty', sku: 'SKU-EMPTY' })])
  const ebay = createMockEbayApis()

  assert.equal((await syncPendingQuantities(depsFor(prisma.store, ebay.apis))).skipped, 1)
  assert.deepEqual(ebay.calls, [])
  const row = prisma.table.get('row-empty')!
  assert.equal(row.status, 'sync-failed')
  assert.match((row as unknown as { lastError: string }).lastError, /no eBay offer id or item id/)
})

test('push: a multi-variation rejection settles the row synced (no retry loop)', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-var',
      sku: 'SKU-VAR',
      ebayListingId: 'ITEM-VAR',
      lastSyncedQty: 1,
      product: { stockCount: 6, status: 'published', sku: 'SKU-VAR' },
    }),
  ])
  const ebay = createMockEbayApis({
    tradingError: new Error('eBay rejected ReviseInventoryStatus; variation listings cannot be updated at item level'),
  })

  assert.deepEqual(
    await syncPendingQuantities(depsFor(prisma.store, ebay.apis)),
    { synced: 0, failed: 0, skipped: 1 },
  )
  const row = prisma.table.get('row-var')!
  assert.equal(row.status, 'synced')
  assert.equal(row.lastSyncedQty, 6)
})

test('push: retryable failure re-queues as sync-pending and never rolls back central stock', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-503',
      sku: 'SKU-503',
      ebayOfferId: 'OFFER-503',
      lastSyncedQty: 1,
      product: { stockCount: 4, status: 'published', sku: 'SKU-503' },
    }),
  ])
  const ebay = createMockEbayApis({ offerError: new Error('eBay updateOffer failed (503): service unavailable') })

  assert.deepEqual(
    await syncPendingQuantities(depsFor(prisma.store, ebay.apis)),
    { synced: 0, failed: 1, skipped: 0 },
  )
  const row = prisma.table.get('row-503')!
  assert.equal(row.status, 'sync-pending')
  assert.equal(row.product.stockCount, 4) // central truth untouched
  assert.equal(row.lastSyncedQty, 1) // snapshot unchanged
  assert.match((row as unknown as { lastError: string }).lastError, /503/)
})

test('push: a permanent validation failure is marked sync-failed, not retried forever', async () => {
  const prisma = createMockPrisma([
    mirrorRow({ id: 'row-400', sku: 'SKU-400', ebayOfferId: 'OFFER-400' }),
  ])
  const ebay = createMockEbayApis({
    offerError: new Error('eBay updateOffer failed (400): invalid category id'),
  })

  assert.equal((await syncPendingQuantities(depsFor(prisma.store, ebay.apis))).failed, 1)
  const row = prisma.table.get('row-400')!
  assert.equal(row.status, 'sync-failed')
  assert.match((row as unknown as { lastError: string }).lastError, /invalid category id/)
})

test('push: one sweep is bounded by the batch size, oldest-first', async () => {
  const seed = Array.from({ length: 3 }, (_, index) => mirrorRow({
    id: `row-${index}`,
    sku: `SKU-${index}`,
    ebayOfferId: `OFFER-${index}`,
    product: { stockCount: index + 1, status: 'published', sku: `SKU-${index}` },
  }))
  const prisma = createMockPrisma(seed)
  const ebay = createMockEbayApis()
  const store = prisma.store
  // Prisma orders by updatedAt asc; the mock orders by id, which is the same
  // stable order these ids were seeded in.
  await syncPendingQuantities(depsFor(store, ebay.apis), { batchSize: 2 })

  assert.deepEqual(ebay.calls.map((call) => call.id), ['OFFER-0', 'OFFER-1'])
  assert.equal(prisma.table.get('row-2')!.status, 'sync-pending')
})

test('push now: reads the row fresh, pushes it and reports the central quantity', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-now',
      sku: 'SKU-NOW',
      ebayOfferId: 'OFFER-NOW',
      product: { stockCount: 12, status: 'published', sku: 'SKU-NOW' },
    }),
  ])
  const ebay = createMockEbayApis()

  const result = await pushListingNow(depsFor(prisma.store, ebay.apis), 'row-now')
  assert.equal(result.ok, true)
  assert.match(result.message, /12/)
  assert.deepEqual(ebay.calls, [{ channel: 'offer', id: 'OFFER-NOW', quantity: 12 }])

  const missing = await pushListingNow(depsFor(prisma.store, ebay.apis), 'does-not-exist')
  assert.deepEqual(missing, { ok: false, message: 'eBay listing not found' })
})

// ─── reconcile path ────────────────────────────────────────────

test('reconcile: re-enqueues only genuinely drifted, non-paused, non-archived rows', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-drift',
      sku: 'SKU-DRIFT',
      status: 'synced',
      ebayOfferId: 'OFFER-D',
      lastSyncedQty: 1,
      product: { stockCount: 9, status: 'published', sku: 'SKU-DRIFT' },
    }),
    mirrorRow({
      id: 'row-match',
      sku: 'SKU-MATCH',
      status: 'synced',
      ebayOfferId: 'OFFER-M',
      lastSyncedQty: 5,
      product: { stockCount: 5, status: 'published', sku: 'SKU-MATCH' },
    }),
    mirrorRow({
      id: 'row-never',
      sku: 'SKU-NEVER',
      status: 'published',
      ebayOfferId: 'OFFER-N',
      lastSyncedQty: null,
      product: { stockCount: 2, status: 'draft', sku: 'SKU-NEVER' },
    }),
    mirrorRow({
      id: 'row-paused',
      sku: 'SKU-P',
      status: 'sync-failed',
      syncDisabled: true,
      lastSyncedQty: 0,
      product: { stockCount: 4, status: 'published', sku: 'SKU-P' },
    }),
    mirrorRow({
      id: 'row-archived',
      sku: 'SKU-A',
      status: 'synced',
      lastSyncedQty: 0,
      product: { stockCount: 4, status: 'archived', sku: 'SKU-A' },
    }),
  ])

  const drifted = await reconcileQuantities(depsFor(prisma.store, createMockEbayApis().apis))
  assert.equal(drifted, 2) // drift + never-pushed; paused/archived/match untouched

  assert.equal(prisma.table.get('row-drift')!.status, 'sync-pending')
  assert.match((prisma.table.get('row-drift') as unknown as { lastError: string }).lastError, /central=9 lastSynced=1/)
  assert.equal(prisma.table.get('row-never')!.status, 'sync-pending')
  assert.equal(prisma.table.get('row-match')!.status, 'synced')
  assert.equal(prisma.table.get('row-paused')!.status, 'sync-failed')
  assert.equal(prisma.table.get('row-archived')!.status, 'synced')
})

test('reconcile + push: a full sweep converges central stock onto eBay', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-flow',
      sku: 'SKU-FLOW',
      status: 'synced',
      ebayOfferId: 'OFFER-FLOW',
      lastSyncedQty: 2,
      product: { stockCount: 11, status: 'published', sku: 'SKU-FLOW' },
    }),
  ])
  const ebay = createMockEbayApis()
  const deps = depsFor(prisma.store, ebay.apis)

  assert.equal(await reconcileQuantities(deps), 1)
  assert.deepEqual(await syncPendingQuantities(deps, { batchSize: PUSH_BATCH_SIZE }), {
    synced: 1, failed: 0, skipped: 0,
  })

  assert.deepEqual(ebay.calls, [{ channel: 'offer', id: 'OFFER-FLOW', quantity: 11 }])
  assert.equal(prisma.table.get('row-flow')!.lastSyncedQty, 11)
  assert.equal(prisma.table.get('row-flow')!.status, 'synced')
  // Nothing left to push once the snapshot matches.
  assert.equal(await reconcileQuantities(deps), 0)
})

test('reconcile: a repeated retryable failure does not corrupt the snapshot', async () => {
  const prisma = createMockPrisma([
    mirrorRow({
      id: 'row-retry',
      sku: 'SKU-RETRY',
      status: 'synced',
      ebayOfferId: 'OFFER-R',
      lastSyncedQty: 3,
      product: { stockCount: 8, status: 'published', sku: 'SKU-RETRY' },
    }),
  ])
  const ebay = createMockEbayApis({ offerError: new Error('eBay updateOffer failed (429): call limit exceeded') })
  const deps = depsFor(prisma.store, ebay.apis)

  await reconcileQuantities(deps)
  await syncPendingQuantities(deps)

  const row = prisma.table.get('row-retry')!
  assert.equal(row.status, 'sync-pending') // still queued for the next sweep
  assert.equal(row.lastSyncedQty, 3) // snapshot untouched by the failure
  assert.equal(row.product.stockCount, 8)
})
