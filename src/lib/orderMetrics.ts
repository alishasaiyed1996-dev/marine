/**
 * Helpers for reading order-item numbers from the API.
 *
 * Admin order responses expose `unitPrice` / `totalPrice` / `productSku`, not
 * the legacy `price` / `sku` fields some dashboard widgets were written
 * against. Centralising the fallbacks keeps every revenue figure consistent.
 */

export interface OrderItemLike {
  quantity?: number | null
  totalPrice?: number | string | null
  unitPrice?: number | string | null
  price?: number | string | null
  productSku?: string | null
  sku?: string | null
}

export function orderItemLineTotal(item: OrderItemLike | null | undefined): number {
  if (!item) return 0
  const quantity = Number(item.quantity) || 1
  if (item.totalPrice !== undefined && item.totalPrice !== null) {
    const total = Number(item.totalPrice)
    return Number.isFinite(total) ? total : 0
  }
  const unitPrice = Number(item.unitPrice ?? item.price)
  return Number.isFinite(unitPrice) ? unitPrice * quantity : 0
}

export function orderItemSku(item: OrderItemLike | null | undefined): string {
  return item?.productSku || item?.sku || ''
}

/** Resolve a relation that may arrive either as a plain string or `{ name }`. */
export function relationName(
  value: string | { name?: string | null } | null | undefined,
  fallback = '',
): string {
  if (typeof value === 'string') return value || fallback
  return value?.name || fallback
}
