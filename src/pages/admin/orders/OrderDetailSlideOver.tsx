import {
  X, User, FileText, CreditCard, MapPin, Truck, Download,
  CheckCircle, AlertTriangle, XCircle,
} from 'lucide-react'
import type { Order } from './types'
import { statusConfig, getNextStatuses, formatDate, formatDateTime } from './types'
import { getAdminToken } from '../../../lib/api'
import { API_BASE } from '../../../lib/api/core'
import { useToast } from '../../../components/admin/toast-context'

interface OrderDetailSlideOverProps {
  order: Order
  orders: Order[]
  onClose: () => void
  onAdvanceStatus: (orderId: string) => void
  onCancelOrder: (orderId: string) => void
  onOpenTracking: (order: Order) => void
  onRefresh?: () => void
}

export function OrderDetailSlideOver({
  order, orders, onClose, onAdvanceStatus, onCancelOrder, onOpenTracking, onRefresh: _onRefresh,
}: OrderDetailSlideOverProps) {
  const { toast } = useToast()

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-xl max-md:max-w-full max-md:rounded-none bg-[var(--surface)] shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
              {order.orderNumber}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {formatDate(order.createdAt)} · {order.company}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status + Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge status={order.status} />
              <span className={`text-xs font-bold ${
                order.paymentStatus === 'paid' ? 'text-[var(--success)]' :
                order.paymentStatus === 'refunded' ? 'text-[var(--danger)]' :
                'text-[var(--accent-gold)]'
              }`}>
                Payment: {order.paymentStatus}
              </span>
            </div>
          </div>

          {/* Status Update Buttons */}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <div className="rounded-xl border border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/5 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">Update Status</h3>
              <div className="flex flex-wrap gap-2">
                {getNextStatuses(order.status).map((next) => {
                  const cfg = statusConfig[next.status]
                  const NextIcon = cfg.icon
                  return (
                    <button
                      key={next.status}
                      onClick={() => onAdvanceStatus(order.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-current/20 bg-[var(--success)]/10 px-3 py-2 text-xs font-bold text-[var(--success)] hover:bg-[var(--success)]/20 transition-colors"
                    >
                      <NextIcon size={12} /> Mark as {cfg.label}
                    </button>
                  )
                })}
                <button
                  onClick={() => onCancelOrder(order.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-xs font-bold text-[var(--danger)] hover:bg-[var(--danger)]/20 transition-colors"
                >
                  <XCircle size={12} /> Cancel Order
                </button>
              </div>
            </div>
          )}

          {order.status === 'delivered' && (
            <div className="rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/5 p-4 text-center">
              <CheckCircle size={20} className="mx-auto text-[var(--success)] mb-1" />
              <p className="text-xs font-bold text-[var(--success)]">Order Delivered</p>
            </div>
          )}

          {order.status === 'cancelled' && (
            <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-4 text-center">
              <AlertTriangle size={20} className="mx-auto text-[var(--danger)] mb-1" />
              <p className="text-xs font-bold text-[var(--danger)]">Order Cancelled</p>
            </div>
          )}

          {/* Customer Info */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Customer</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <User size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-secondary)]">{order.customerName}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-secondary)]">{order.customerEmail}</span>
              </div>
              <div className="flex items-center gap-2">
                <CreditCard size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-secondary)]">{order.paymentMethod}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-secondary)]">{order.country}</span>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-xl border border-[var(--border)] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">Items</h3>
            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{item.productName}</p>
                    <p className="text-[0.625rem] text-[var(--text-muted)] font-mono">{item.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[var(--text-primary)]">${(item.price * item.quantity).toLocaleString()}</p>
                    <p className="text-[0.625rem] text-[var(--text-muted)]">{item.quantity} × ${item.price}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Subtotal</span>
                <span className="font-mono font-bold">${order.subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Shipping</span>
                <span className="font-mono font-bold">${order.shipping.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Tax</span>
                <span className="font-mono font-bold">${order.tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1 border-t border-[var(--border)]">
                <span>Total</span>
                <span className="font-mono text-[var(--accent-gold)]">${order.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Shipping */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Shipping</h3>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <MapPin size={12} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
                <span className="text-xs text-[var(--text-secondary)] whitespace-pre-line">{order.shippingAddress}</span>
              </div>
              {order.trackingNumber && (
                <div className="flex items-center gap-2">
                  <Truck size={12} className="text-[var(--text-muted)]" />
                  <span className="text-xs text-[var(--text-secondary)]">
                    {order.courier} · <span className="font-mono font-bold">{order.trackingNumber}</span>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Tracking Timeline */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Tracking Timeline</h3>
            <div className="space-y-0">
              {order.timeline.map((event, i) => {
                const cfg = statusConfig[event.status]
                const EventIcon = cfg.icon
                const isLast = i === order.timeline.length - 1
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`flex h-6 w-6 items-center justify-center rounded-full ${cfg.bg} ${cfg.color} shrink-0`}>
                        <EventIcon size={10} />
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-[var(--border)] my-1" />}
                    </div>
                    <div className="pb-4">
                      <p className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</p>
                      <p className="text-[0.625rem] text-[var(--text-muted)]">{formatDateTime(event.date)}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{event.note}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button onClick={async () => {
              const realOrder = orders.find((o) => o.id === order.id)
              const orderId = realOrder?.id || order.id
              try {
                const token = getAdminToken()
                const res = await fetch(`${API_BASE}/admin/orders/${orderId}/invoice`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  credentials: 'include',
                })
                if (!res.ok) {
                  let message = `Failed to generate invoice (HTTP ${res.status})`
                  try {
                    const body = await res.json()
                    if (body?.error) message = body.error
                  } catch { /* non-JSON error body */ }
                  throw new Error(message)
                }
                const html = await res.text()
                const blob = new Blob([html], { type: 'text/html' })
                const url = URL.createObjectURL(blob)
                window.open(url, '_blank')
                setTimeout(() => URL.revokeObjectURL(url), 60000)
              } catch (err: unknown) {
                toast(err instanceof Error ? err.message : 'Failed to generate invoice', 'error')
              }
            }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors">
              <Download size={12} /> Invoice
            </button>
            <button onClick={() => onOpenTracking(order)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-teal)] transition-colors">
              <Truck size={12} /> Update Tracking
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Order['status'] }) {
  const cfg = statusConfig[status]
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${cfg.bg} ${cfg.color}`}>
      <Icon size={12} />
      {cfg.label}
    </span>
  )
}
