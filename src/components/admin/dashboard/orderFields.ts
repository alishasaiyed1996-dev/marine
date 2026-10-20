/**
 * Accessors for the admin order payload.
 *
 * The dashboard widgets consume raw `ApiOrder` objects, whose customer lives
 * under `order.customer` (see shared/types.ts: `customer?: { id, name, email }`).
 * There is no top-level `order.email` / `order.customerEmail` / `order.customerName`
 * on that payload, so reading them directly returned `''` and collapsed every
 * customer aggregate into a single empty-string bucket. These helpers accept
 * any of the shapes (raw API, or the normalized admin-orders view) so the
 * widgets stay correct regardless of the source.
 */

export function orderCustomerEmail(order: any): string {
  return order?.customer?.email || order?.customerEmail || order?.email || ''
}

export function orderCustomerName(order: any): string {
  const explicit = order?.customer?.name || order?.customerName
  if (explicit) return explicit
  const email = orderCustomerEmail(order)
  return email ? email.split('@')[0] : 'Customer'
}

/** Orders have no deliveredAt column; the timeline records the transition. */
export function orderDeliveredAt(order: any): string | null {
  const timeline = Array.isArray(order?.timeline) ? order.timeline : []
  const deliveredEvent = timeline.find((entry: any) => entry?.status === 'delivered')
  return order?.deliveredAt || deliveredEvent?.createdAt || order?.updatedAt || null
}
