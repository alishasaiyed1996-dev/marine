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
