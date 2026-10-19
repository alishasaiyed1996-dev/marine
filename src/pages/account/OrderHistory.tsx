import { Link, Navigate } from 'react-router-dom'
import { Package, Eye, Clock, Truck, CheckCircle, XCircle, ChevronRight } from 'lucide-react'
import { useOrders } from '../../hooks/useApiQuery'
import { useStore } from '../../store/useStore'
import { useLocalizedPath } from '../../lib/locale'
import { Skeleton } from '../../components/ui/Skeleton'

const statusConfig: Record<string, { color: string; icon: typeof Package }> = {
  pending: { color: 'text-[var(--text-muted)]', icon: Clock },
  confirmed: { color: 'text-[var(--accent-primary)]', icon: CheckCircle },
  'payment-pending': { color: 'text-[var(--accent-gold)]', icon: Clock },
  paid: { color: 'text-[var(--accent-primary)]', icon: CheckCircle },
  processing: { color: 'text-[var(--accent-primary)]', icon: Package },
  packed: { color: 'text-[var(--accent-primary)]', icon: Package },
  shipped: { color: 'text-[var(--accent-teal)]', icon: Truck },
  delivered: { color: 'text-[var(--success)]', icon: CheckCircle },
  cancelled: { color: 'text-[var(--danger)]', icon: XCircle },
}

export default function OrderHistory() {
  const user = useStore((s) => s.user)
  const lp = useLocalizedPath()
  const { data: orders, isLoading, isError, error } = useOrders(Boolean(user))
  const errorMessage = error instanceof Error ? error.message : 'Failed to load orders'

  // Redirect after render instead of during it (React forbids navigation
  // side effects in the render phase).
  if (!user) {
    return <Navigate to={lp('/')} replace />
  }

  return (
    <div className="min-h-screen bg-[var(--primary-bg)]">
      {/* Header */}
      <section className="bg-[var(--secondary-bg)] py-12">
        <div className="max-w-[1024px] mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-muted)]">
            <Link to={lp('/')} className="hover:text-[var(--text-secondary)]">Home</Link>
            <ChevronRight size={12} />
            <span className="text-[var(--text-secondary)]">My Orders</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-[var(--text-primary)]">Order History</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">View and track your past orders</p>
        </div>
      </section>

      <section className="py-10">
        <div className="max-w-[1024px] mx-auto px-4 sm:px-6">
          {isLoading ? (
            <div className="space-y-4" aria-hidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <Skeleton className="h-4 w-1/3 mb-3" />
                  <Skeleton className="h-3 w-1/2 mb-4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-20">
              <p className="text-sm text-[var(--danger)]">{errorMessage}</p>
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="text-center py-20">
              <Package size={48} className="text-[var(--text-muted)] mx-auto mb-4" />
              <h2 className="font-display text-xl font-bold text-[var(--text-primary)] mb-2">No orders yet</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-6">Start shopping to see your orders here.</p>
              <Link
                to={lp('/products')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all"
              >
                Browse Products
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const status = statusConfig[order.status] || statusConfig.pending
                const StatusIcon = status.icon
                const items = order.items ?? []
                return (
                  <div
                    key={order.id}
                    className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent-primary)]/30 transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono text-sm font-bold text-[var(--text-primary)]">#{order.orderNumber}</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${status.color}`}>
                            <StatusIcon size={12} />
                            {order.status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          {items.length > 0 && (
                            <> · {items.length} item{items.length > 1 ? 's' : ''}</>
                          )}
                        </p>
                        {items.length > 0 && (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">
                            {items.slice(0, 3).map((i) => i.productName).join(', ')}
                            {items.length > 3 && ` +${items.length - 3} more`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-display text-lg font-bold text-[var(--text-primary)]">
                          ${Number(order.grandTotal || 0).toFixed(2)}
                        </span>
                        <Link
                          to={lp(`/track-order?id=${encodeURIComponent(order.orderNumber)}`)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-[var(--border)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/5 rounded-xl transition-all"
                        >
                          <Eye size={12} /> Track
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
