/**
 * eBay order processing (roadmap C — eBay sale flow).
 *
 * eBay event → validate → identify SKU via ebay_listings mapping → create the
 * internal order once → claim stock through the central inventory service.
 *
 * Draft/hidden products with a system-managed eBay listing claim stock exactly
 * like published ones (sellableOnEbay): the website publish gate controls
 * storefront visibility, not inventory — imported items sell on eBay while
 * still drafts, and those sales must move central stock.
 *
 * Idempotency: the eBay notification id is stored UNIQUELY in ebay_event_log;
 * a redelivered event short-circuits as 'duplicate' — no second deduction.
 * Order-level dedupe: ebay_orders.ebay_order_id is UNIQUE, so even a webhook
 * that bypasses the event log cannot create two internal orders.
 *
 * The order is ALWAYS re-fetched from the Fulfillment API before stock is
 * touched — a notification payload alone is never trusted (spec rule).
 * `fetchOrder` is injectable for tests.
 */
import { prisma } from '../server.js'
import { generateOrderNumber } from '../utils/helpers.js'
import logger from '../utils/logger.js'
import { decreaseStock, increaseStock } from './centralInventory.js'
import { getOrder, listOrdersSince, isEbayConfigured, isRetryableError, type EbayApiOrder } from './ebayClient.js'
import { extractOrderId, sellableOnEbay, skuCandidates } from './ebayOrderEvents.js'

// Re-exported for webhook route convenience.
export { extractOrderId, extractEventId } from './ebayOrderEvents.js'

const log = logger.child({ context: 'ebay-orders' })

export interface ProcessEventResult {
  status: 'processed' | 'duplicate' | 'ignored' | 'failed' | 'deferred'
  note?: string
}

/**
 * Process an eBay order notification. Steps mirror the spec's eBay sale flow.
 * Deferred = temporary failure (network/5xx) — the event stays 'received' and
 * a scheduler retry will reprocess it.
 */
export async function processEbayOrderEvent(
  eventId: string,
  topic: string,
  payload: Record<string, unknown>,
  deps: { fetchOrder?: (id: string) => Promise<EbayApiOrder> } = {},
): Promise<ProcessEventResult> {
  const fetchOrder = deps.fetchOrder || getOrder

  // ── Idempotency gate: unique(eventId) — insert wins, duplicates no-op. ──
  try {
    await prisma.ebayEventLog.create({ data: { eventId, topic, payload: payload as object } })
  } catch {
    const existingEvent = await prisma.ebayEventLog.findUnique({ where: { eventId } })
    // A 'received' row is a deferred event being retried by the scheduler.
    // Let the retry proceed instead of treating its own event id as a duplicate.
    if (!existingEvent || existingEvent.status !== 'received') {
      log.info({ eventId, topic }, 'Duplicate eBay event — already processed, skipping')
      await prisma.ebayEventLog.updateMany({
        where: { eventId, status: 'failed' },
        data: { status: 'duplicate' },
      })
      return { status: 'duplicate', note: 'event already seen' }
    }
    log.info({ eventId, topic }, 'Retrying deferred eBay event')
  }

  let activeOrderId: string | null = null

  try {
    const orderId = extractOrderId(payload)
    if (!orderId) {
      await markEvent(eventId, 'ignored', 'no orderId in payload')
      return { status: 'ignored', note: 'no orderId in payload' }
    }

    // ── Order-level idempotency: claim this eBay order atomically. Event ids
    // differ for redeliveries/poll buckets, so the unique ebay_order_id row is
    // the real guard against creating two internal orders (and two deductions).
    const existing = await prisma.ebayOrder.findUnique({ where: { ebayOrderId: orderId } })
    if (existing && existing.status === 'processed') {
      await markEvent(eventId, 'duplicate', `order ${orderId} already processed`)
      return { status: 'duplicate', note: 'order already processed' }
    }
    const orderClaimed = await claimEbayOrder(orderId)
    if (!orderClaimed) {
      await markEvent(eventId, 'duplicate', `order ${orderId} is already being processed`)
      return { status: 'duplicate', note: 'order already being processed' }
    }
    activeOrderId = orderId

    // ── Verify against the real API — never trust the payload alone. ──
    let ebayOrder: EbayApiOrder
    try {
      ebayOrder = await fetchOrder(orderId)
    } catch (err) {
      if (isRetryableError(err)) {
        // Event log row stays 'received' → scheduler reprocesses later.
        // Release the order claim so that retry can take it immediately.
        await releaseEbayOrderClaim(orderId, 'temporary eBay API failure')
        log.warn({ err, orderId, eventId }, 'eBay order fetch deferred (temporary failure)')
        return { status: 'deferred', note: 'temporary API failure — will retry' }
      }
      // Permanent (e.g. 404 — order gone). Mark and stop.
      await markEvent(eventId, 'failed', `order fetch failed permanently: ${(err as Error).message}`)
      return { status: 'failed', note: 'order fetch failed permanently' }
    }

    // Only paid orders claim stock.
    if (ebayOrder.orderPaymentStatus && ebayOrder.orderPaymentStatus !== 'PAID') {
      await upsertEbayOrder(orderId, 'ignored', ebayOrder, `payment status ${ebayOrder.orderPaymentStatus} — not claiming stock`)
      await markEvent(eventId, 'ignored', `payment status ${ebayOrder.orderPaymentStatus} — not claiming stock`)
      return { status: 'ignored', note: 'order not paid' }
    }

    // ── Map line items to internal products BY SKU. ──
    // The product SKU is the link between the channels: a website product with
    // the same SKU is the same physical stock. The ebay_listings mirror row is
    // the fast path AND the eligibility witness for drafts (see sellableOnEbay):
    // system-managed listings claim stock even while the product is unpublished.
    const lineItems = ebayOrder.lineItems || []
    const mapped: Array<{ productId: string; sku: string; quantity: number; title: string; unitPrice: number }> = []
    const unmappedSkus: string[] = []
    for (const li of lineItems) {
      const sku = li.sku
      if (!sku) { unmappedSkus.push('(no sku)'); continue }
      const candidates = skuCandidates(sku)
      const listing = await prisma.ebayListing.findFirst({
        where: { sku: { in: candidates } },
        select: { id: true, status: true, productId: true, product: { select: { regularPrice: true, salePrice: true, status: true } } },
      })
      // No mirror row? A published website product with the same SKU still
      // claims (published-only — see sellableOnEbay for why drafts need the
      // mirror row to be trusted as this system's own listing).
      let productFallback: { id: string; regularPrice: unknown; salePrice: unknown; status: string } | null = null
      if (!listing) {
        productFallback = await prisma.product.findFirst({
          where: { sku: { in: candidates } },
          select: { id: true, regularPrice: true, salePrice: true, status: true },
        })
        if (!productFallback) {
          // Case-insensitive last resort — eBay SKUs differ in case now and then.
          for (const candidate of candidates) {
            productFallback = await prisma.product.findFirst({
              where: { sku: { equals: candidate, mode: 'insensitive' } },
              select: { id: true, regularPrice: true, salePrice: true, status: true },
            })
            if (productFallback) break
          }
        }
        if (productFallback) {
          log.info({ sku, productId: productFallback.id }, 'eBay sale matched a website product by SKU (no mirror row)')
        }
      }
      const product = listing ? { id: listing.productId, ...listing.product } : productFallback
      // Channel eligibility is a pure rule (sellableOnEbay in ebayOrderEvents.ts,
      // unit-tested): a system-managed mirror row means this product sells on
      // eBay regardless of website status (imported items are drafts until the
      // admin clears the publish gate), while the SKU-fallback path stays
      // published-only. Stock truth must not depend on the website publish gate.
      if (!product || !sellableOnEbay(product, listing)) {
        unmappedSkus.push(sku)
        continue
      }
      const regular = Number(product.regularPrice) || 0
      const sale = product.salePrice != null ? Number(product.salePrice) : null
      const catalogUnit = sale != null && sale > 0 && sale < regular ? sale : regular
      const quantity = li.quantity || 1
      // Prefer what the buyer actually paid on eBay over the current catalogue
      // price; a later local price change must not rewrite eBay order revenue.
      const lineCost = Number(li.lineItemCost?.value)
      const unitPrice = Number.isFinite(lineCost) && lineCost > 0
        ? Math.round((lineCost / quantity) * 100) / 100
        : catalogUnit
      mapped.push({
        productId: product.id,
        sku,
        quantity,
        title: li.title || sku,
        unitPrice,
      })
    }

    if (mapped.length === 0) {
      // No website product carries these SKUs (or none is sellable on eBay —
      // draft items without a managed listing, or archived ones): stay
      // explicit — stock is never guessed.
      await upsertEbayOrder(orderId, 'failed', ebayOrder, 'no mapped line items — no eBay-linked or published website product matches these SKUs')
      await markEvent(eventId, 'failed', `unmapped SKUs: ${unmappedSkus.join(', ') || 'none'}`)
      log.warn({ orderId, unmappedSkus }, 'eBay order has no mapped internal products')
      return { status: 'failed', note: 'no mapped line items' }
    }

    // ── Create the internal order (paid, provenance-tagged). ──
    const subtotal = mapped.reduce((s, m) => s + m.unitPrice * m.quantity, 0)
    const total = ebayOrder.total?.value != null ? Number(ebayOrder.total.value) : subtotal
    const currency = ebayOrder.total?.currency || 'USD'
    const order = await prisma.order.create({
      data: {
        orderNumber: await generateOrderNumber(),
        status: 'paid',
        paymentMethod: 'ebay',
        paymentStatus: 'paid',
        subtotal,
        shippingCost: 0,
        tax: 0,
        total,
        currency,
        shippingFullName: 'eBay order (see eBay order details)',
        shippingCountry: 'US',
        customerNotes: `[ebay:${orderId}]`,
      },
    })

    // ── Claim stock through CENTRAL INVENTORY (atomic, race-safe). ──
    const failures: string[] = []
    const claimed: Array<{ productId: string; quantity: number }> = []
    try {
      for (const m of mapped) {
        const res = await decreaseStock(m.productId, m.quantity, 'ebay', { orderId: order.id })
        if (res.ok) claimed.push({ productId: m.productId, quantity: m.quantity })
        else failures.push(`${m.sku}: ${res.reason}`)
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: m.productId,
            productName: m.title,
            productSku: m.sku,
            quantity: m.quantity,
            unitPrice: m.unitPrice,
            totalPrice: m.unitPrice * m.quantity,
          },
        })
      }
      if (failures.length > 0) throw new Error(`stock claim failed: ${failures.join('; ')}`)
    } catch (err) {
      // Never leave a paid-looking order without stock (existing architecture
      // rule). Remove the order rows; the EbayOrder row records the failure.
      // Restore every unit already claimed by this attempt first.
      for (const item of claimed) {
        await increaseStock(item.productId, item.quantity, 'ebay', {
          orderId: order.id,
          note: 'Rollback after partial stock failure (eBay order import)',
        }).catch(rollbackErr => log.error({ rollbackErr, ...item, orderId: order.id }, 'eBay stock rollback failed'))
      }
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } })
      await prisma.orderTimeline?.deleteMany?.({ where: { orderId: order.id } }).catch(() => {})
      await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
      await upsertEbayOrder(orderId, 'failed', ebayOrder, (err as Error).message)
      await markEvent(eventId, 'failed', (err as Error).message)
      log.error({ err, orderId, eventId }, 'eBay order stock claim failed — order rolled back')
      return { status: 'failed', note: (err as Error).message }
    }

    await prisma.orderTimeline.create({
      data: { orderId: order.id, status: 'paid', note: `eBay order ${orderId} imported — stock claimed via central inventory` },
    }).catch(() => {})

    await upsertEbayOrder(orderId, 'processed', ebayOrder, undefined, order.id)
    await markEvent(eventId, 'processed')

    // Central stock hits 0 → other channels were already synced by
    // decreaseStock's enqueue (including the just-sold listing's own offer).
    log.info({ orderId, internalOrderId: order.id, items: mapped.length }, 'eBay order processed')
    return { status: 'processed' }
  } catch (err) {
    log.error({ err, eventId, topic }, 'eBay order event processing failed')
    if (activeOrderId) await releaseEbayOrderClaim(activeOrderId, (err as Error).message)
    await markEvent(eventId, 'failed', (err as Error).message)
    return { status: 'failed', note: (err as Error).message }
  }
}

const PROCESSING_STALE_MS = 10 * 60 * 1000

/**
 * Atomically claim an eBay order before creating an internal order. The
 * unique ebay_order_id guarantees only one worker wins; failed/ignored or
 * stale processing rows may be retried.
 */
async function claimEbayOrder(orderId: string): Promise<boolean> {
  try {
    await prisma.ebayOrder.create({ data: { ebayOrderId: orderId, status: 'processing' } })
    return true
  } catch {
    const claimed = await prisma.ebayOrder.updateMany({
      where: {
        ebayOrderId: orderId,
        OR: [
          { status: { in: ['failed', 'ignored'] } },
          { status: 'processing', updatedAt: { lt: new Date(Date.now() - PROCESSING_STALE_MS) } },
        ],
      },
      data: { status: 'processing', lastError: null, processedAt: null },
    })
    return claimed.count > 0
  }
}

/** Release a processing claim after a retryable failure. */
async function releaseEbayOrderClaim(orderId: string, reason: string) {
  await prisma.ebayOrder.updateMany({
    where: { ebayOrderId: orderId, status: 'processing' },
    data: { status: 'failed', lastError: reason },
  }).catch(() => {})
}

async function markEvent(eventId: string, status: string, error?: string) {
  await prisma.ebayEventLog.updateMany({
    where: { eventId },
    data: { status, error, processedAt: new Date() },
  })
}

async function upsertEbayOrder(
  ebayOrderId: string,
  status: string,
  ebayOrder: EbayApiOrder,
  error?: string,
  internalOrderId?: string,
) {
  await prisma.ebayOrder.upsert({
    where: { ebayOrderId },
    create: {
      ebayOrderId,
      status,
      totalAmount: ebayOrder.total?.value != null ? Number(ebayOrder.total.value) : null,
      currency: ebayOrder.total?.currency || null,
      lastError: error,
      orderId: internalOrderId,
      processedAt: status === 'processed' ? new Date() : null,
    },
    update: {
      status,
      lastError: error,
      orderId: internalOrderId ?? undefined,
      processedAt: status === 'processed' ? new Date() : undefined,
    },
  })
}

/**
 * Retry deferred/failed events that stay 'received' (temporary failures at
 * webhook time). Called by the sync scheduler.
 */
export async function retryPendingEvents(maxAgeMinutes = 24 * 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)
  const pending = await prisma.ebayEventLog.findMany({
    where: { status: 'received', createdAt: { gte: cutoff } },
    select: { id: true, eventId: true, topic: true, payload: true },
    take: 50,
    orderBy: { createdAt: 'asc' },
  })
  let retried = 0
  for (const ev of pending) {
    const payload = (ev.payload || {}) as Record<string, unknown>
    const res = await processEbayOrderEvent(ev.eventId, ev.topic, payload)
    if (res.status !== 'deferred') retried++
  }
  return retried
}

/**
 * Reliability net for webhook-delivery gaps: pull recent orders from the
 * Fulfillment API and run them through the same idempotent processor.
 *
 * Order-level dedupe (ebay_orders + the 'processed' check) prevents double
 * stock claims; a fresh hourly event-id bucket lets FAILED orders retry later
 * (e.g. after the admin maps a missing SKU) without ever touching processed
 * ones. The default window stays short on purpose — central stock already
 * reflects sales that predate the mirror; backfilling old orders would
 * double-count them.
 */
export async function pollEbayOrders(hoursBack = 72): Promise<number> {
  if (!isEbayConfigured()) return 0
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()
  const orders = await listOrdersSince(since)
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000))
  let processed = 0
  for (const o of orders) {
    if (!o.orderId) continue
    const existing = await prisma.ebayOrder.findUnique({ where: { ebayOrderId: o.orderId } })
    if (existing?.status === 'processed') continue
    const res = await processEbayOrderEvent(`poll:${o.orderId}:${bucket}`, 'POLL', { orderId: o.orderId })
    if (res.status === 'processed') processed++
  }
  return processed
}
