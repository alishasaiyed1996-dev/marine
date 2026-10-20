import { useMemo } from 'react'
import { AlertTriangle, Clock, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function RestockPredictor({ products, orders }: Props) {
  const recommendations = useMemo(() => {
    const lowStock = products.filter(p => {
      const threshold = p.lowStockThreshold ?? 10
      return (p.stockCount || 0) <= threshold
    })

    return lowStock.map((p: any) => {
      // Calculate sales velocity from orders
      const productOrders = orders.filter(o =>
        !isCancelledOrRefunded(o) && (o.items || []).some((i: any) => i.productId === p.id)
      )
      const totalSold = productOrders.reduce((s: number, o: any) => {
        const item = (o.items || []).find((i: any) => i.productId === p.id)
        return s + (item?.quantity || 0)
      }, 0)

      // Assume 90-day window for velocity calculation
      const avgDailySales = totalSold / 90
      const daysUntilStockout = avgDailySales > 0
        ? Math.round((p.stockCount || 0) / avgDailySales)
        : Infinity
      const reorderQty = Math.ceil(avgDailySales * 30) // 30-day buffer

      const priority = daysUntilStockout < 7 ? 'urgent' as const
        : daysUntilStockout < 14 ? 'soon' as const
        : 'normal' as const

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        brand: p.brand?.name || p.brand || '—',
        stockCount: p.stockCount || 0,
        lowStockThreshold: p.lowStockThreshold ?? 10,
        avgDailySales: Math.round(avgDailySales * 100) / 100,
        daysUntilStockout,
        reorderQty,
        priority,
      }
    }).sort((a, b) => {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1
      if (a.priority !== 'urgent' && b.priority === 'urgent') return 1
      if (a.priority === 'soon' && b.priority === 'normal') return -1
      return a.daysUntilStockout - b.daysUntilStockout
    })
  }, [products, orders])

  const urgentCount = recommendations.filter(r => r.priority === 'urgent').length
  const soonCount = recommendations.filter(r => r.priority === 'soon').length

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Restock Predictor
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {recommendations.length} items
        </span>
      </div>

      {/* Priority badges */}
      <div className="flex gap-2 mb-4">
        {urgentCount > 0 && (
          <span className="rounded-lg bg-[var(--danger)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--danger)]">
            {urgentCount} urgent
          </span>
        )}
        {soonCount > 0 && (
          <span className="rounded-lg bg-[var(--accent-gold)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-gold)]">
            {soonCount} restock soon
          </span>
        )}
      </div>

      {/* Recommendations */}
      {recommendations.length === 0 ? (
        <div className="text-center py-8">
          <Clock size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] font-medium">All products adequately stocked</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {recommendations.slice(0, 15).map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{r.name}</p>
                  <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${
                    r.priority === 'urgent' ? 'bg-[var(--danger)]/10 text-[var(--danger)]' :
                    r.priority === 'soon' ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]' :
                    'bg-[var(--surface-soft)] text-[var(--text-muted)]'
                  }`}>
                    {r.priority === 'urgent' ? 'URGENT' : r.priority === 'soon' ? 'SOON' : 'NORMAL'}
                  </span>
                </div>
                <p className="text-[0.625rem] text-[var(--text-muted)]">
                  {r.sku} · {r.brand} · {r.stockCount} left
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-[0.625rem] text-[var(--text-muted)]">
                  {r.daysUntilStockout === Infinity ? 'No sales' : `~${r.daysUntilStockout}d left`}
                </p>
                <p className="font-mono text-[0.625rem] font-bold text-[var(--accent-gold)]">
                  Reorder {r.reorderQty}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <Link
          to="/admin/products?filter=low-stock"
          className="mt-3 flex items-center gap-1 text-xs font-bold text-[var(--accent-gold)] hover:underline"
        >
          View all low-stock products <ArrowRight size={12} />
        </Link>
      )}
    </div>
  )
}
