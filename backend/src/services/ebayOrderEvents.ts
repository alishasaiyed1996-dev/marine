/**
 * Pure eBay notification helpers (no Prisma/server imports — unit-testable
 * per the project's pure-module test convention, like offerRules.ts).
 *
 * Real Event Notification Platform (EPN) deliveries nest everything:
 *   { metadata: { topic }, notification: { notificationId, eventDate, data } }
 * The flat shapes remain as fallbacks for synthetic deliveries and older
 * topic payloads.
 */

/** Extract the notification topic across real-EPN and flat shapes. */
export function extractTopic(payload: Record<string, unknown>): string | undefined {
  const meta = payload.metadata as { topic?: unknown } | undefined
  if (meta && typeof meta.topic === 'string' && meta.topic) return meta.topic
  const direct = payload.topic
  if (typeof direct === 'string' && direct) return direct
  const eventType = payload.eventType
  if (typeof eventType === 'string' && eventType) return eventType
  return undefined
}

/** Extract the eBay order id from a notification payload across topic shapes. */
export function extractOrderId(payload: Record<string, unknown>): string | undefined {
  const notification = payload.notification as { data?: { orderId?: unknown } } | undefined
  if (notification?.data && typeof notification.data.orderId === 'string' && notification.data.orderId) {
    return notification.data.orderId
  }
  const direct = payload.orderId
  if (typeof direct === 'string' && direct) return direct
  const snake = payload.order_id
  if (typeof snake === 'string' && snake) return snake
  const nested = payload.data as { orderId?: unknown } | undefined
  if (nested && typeof nested.orderId === 'string' && nested.orderId) return nested.orderId
  const resource = payload.resource as { orderId?: unknown } | undefined
  if (resource && typeof resource.orderId === 'string' && resource.orderId) return resource.orderId
  return undefined
}

/** Extract the notification/event id used for idempotency (EPN + flat). */
export function extractEventId(payload: Record<string, unknown>): string | undefined {
  const notification = payload.notification as { notificationId?: unknown } | undefined
  if (notification && typeof notification.notificationId === 'string' && notification.notificationId) {
    return notification.notificationId
  }
  const n = payload.notificationId
  if (typeof n === 'string' && n) return n
  const e = payload.eventId
  if (typeof e === 'string' && e) return e
  return undefined
}

/**
 * Candidate spellings of an eBay SKU when matching website products. eBay SKUs
 * pick up stray whitespace (leading/trailing, doubled spaces) from Seller Hub,
 * so the raw value, the trimmed value, and the whitespace-collapsed value are
 * all tried — in that order, deduplicated.
 */
export function skuCandidates(rawSku: string): string[] {
  const set = new Set<string>()
  const raw = String(rawSku ?? '')
  if (raw) set.add(raw)
  const trimmed = raw.trim()
  if (trimmed) set.add(trimmed)
  const collapsed = trimmed.replace(/\s+/g, ' ')
  if (collapsed) set.add(collapsed)
  return [...set]
}

/**
 * Whether an eBay sale of this product may claim central stock (pure decision
 * logic — unit-tested in ebayOrderService.test.ts).
 *
 * The ebay_listings mirror row IS the statement "this product is deliberately
 * sold on eBay": imported items stay drafts until the admin clears the publish
 * gate, and they keep selling on eBay the whole time. If drafts could not
 * claim stock, central stock would go stale pre-publish and the first sync
 * after publishing would push that stale snapshot back onto the live listing —
 * resurrecting units that already sold. So ANY system-managed listing claims
 * stock for draft/hidden products too; the publish gate only controls website
 * visibility, not inventory truth.
 *
 * Mirror sync status (sync-pending/synced/failed/ended/pending) is NOT checked
 * on purpose: an 'ended' row does not mean the sale is fake — an order placed
 * before an admin ended the listing can still arrive afterwards through the
 * webhook retry or the order poll, and its stock claim must not be dropped.
 *
 * Without a mirror row (a listing created outside this system that merely
 * matches a website SKU), only a published catalog product claims — never
 * guess that an unknown SKU belongs to this catalog. Archived products end the
 * relationship entirely.
 */
export function sellableOnEbay(
  product: { status: string } | null | undefined,
  listing: { status: string } | null | undefined,
): boolean {
  if (!product || product.status === 'archived') return false
  return listing ? true : product.status === 'published'
}
