// ─── Types ───────────────────────────────────────────────────────────────────────

import type { ApiOrder, ApiOrderItem, ApiOrderTimeline } from '../../../lib/api-types'
import { Package, Truck, Clock, CheckCircle, XCircle, CreditCard } from 'lucide-react'

export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled'

export interface Order {
  /** Backend UUID — use this for every API call. */
  id: string
  /** Human-facing order number (e.g. AT-ORD-...). */
  orderNumber: string
  customerName: string
  customerEmail: string
  company: string
  country: string
  items: { productName: string; sku: string; quantity: number; price: number }[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  status: OrderStatus
  paymentMethod: string
  paymentStatus: 'pending' | 'paid' | 'refunded'
  shippingAddress: string
  trackingNumber: string
  courier: string
  createdAt: string
  notes: string
  timeline: { status: OrderStatus; date: string; note: string }[]
}

const STATUS_FLOW: OrderStatus[] = ['pending', 'confirmed', 'paid', 'processing', 'packed', 'shipped', 'delivered']

export function mapApiOrder(o: ApiOrder): Order {
  const oAny = o as unknown as Record<string, unknown>
  const items = (o.items || o.orderItems || []).map((item: ApiOrderItem) => ({
    productName: item.productName || item.product?.name || 'Unknown Product',
    sku: item.productSku || item.product?.sku || item.sku || '',
    quantity: item.quantity || 1,
    price: Number(item.unitPrice ?? item.price ?? 0),
  }))
  return {
    id: o.id,
    orderNumber: o.orderNumber || o.id,
    customerName: o.customer?.name || o.shippingFullName || (oAny.customerName as string) || o.customer?.email || '',
    customerEmail: o.customer?.email || o.shippingEmail || (oAny.customerEmail as string) || '',
    company: o.customer?.company || (oAny.company as string) || '',
    country: o.shippingCountry || (oAny.country as string) || '',
    items,
    subtotal: Number(o.subtotal ?? 0),
    shipping: Number(o.shippingCost ?? 0),
    tax: Number(o.tax ?? 0),
    total: Number(o.total ?? 0),
    status: (o.status || 'pending') as OrderStatus,
    paymentMethod: o.paymentMethod || 'Bank Transfer',
    paymentStatus: (o.paymentStatus || 'pending') as 'pending' | 'paid' | 'refunded',
    // The API stores the address in flat shipping* columns — the legacy
    // `shippingAddress` string never existed, so it always rendered empty.
    shippingAddress: [
      o.shippingFullName,
      o.shippingAddressLine1,
      o.shippingAddressLine2,
      [o.shippingCity, o.shippingState, o.shippingPostalCode].filter(Boolean).join(', '),
      o.shippingCountry,
    ].filter(Boolean).join('\n'),
    trackingNumber: o.trackingNumber || '',
    courier: o.courier || '',
    createdAt: o.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0],
    notes: (oAny.notes as string) || '',
    timeline: (o.timeline || []).map((t: ApiOrderTimeline) => ({
      status: (t.status || 'pending') as OrderStatus,
      date: t.createdAt || new Date().toISOString(),
      note: t.note || '',
    })),
  }
}

export const statusConfig: Record<OrderStatus, { label: string; color: string; bg: string; icon: typeof Package }> = {
  pending: { label: 'Pending', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: CheckCircle },
  paid: { label: 'Paid', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: CreditCard },
  processing: { label: 'Processing', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', icon: Package },
  packed: { label: 'Packed', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: Package },
  shipped: { label: 'Shipped', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', icon: Truck },
  delivered: { label: 'Delivered', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: XCircle },
}

/** Get the next valid status transitions for a given status */
export function getNextStatuses(current: OrderStatus): { status: OrderStatus; label: string }[] {
  if (current === 'cancelled') return []
  const idx = STATUS_FLOW.indexOf(current)
  if (idx === -1 || idx === STATUS_FLOW.length - 1) {
    return []
  }
  const next = STATUS_FLOW[idx + 1]
  return [{ status: next, label: statusConfig[next].label }]
}

export const ITEMS_PER_PAGE = 15

export function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
