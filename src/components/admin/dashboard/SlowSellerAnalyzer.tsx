import { useMemo } from 'react'
import { AlertCircle, Package } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function SlowSellerAnalyzer({ products, orders }: Props) {
  const slowSellers = useMemo(() => {
    // Calculate sales per product
    const salesMap = new Map<string, number>()
    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      for (const item of order.items || []) {
        if (!item.productId) continue
        salesMap.set(item.productId, (salesMap.get(item.productId) || 0) + (item.quantity || 1))
      }
    }

    const now = Date.now()
    return products
      .filter(p => (p.stockCount || 0) > 0) // Only products in stock
      .map(p => {
        const totalSold = salesMap.get(p.id) || 0
        const daysSinceAdded = Math.max(1, (now - new Date(p.createdAt || Date.now()).getTime()) / 86400000)
        const velocityPerDay = totalSold / daysSinceAdded
        const daysOfStock = velocityPerDay > 0 ? Math.round((p.stockCount || 0) / velocityPerDay) : Infinity

        let recommendation = 'Monitor'
        let recColor = 'text-[var(--text-muted)]'
        if (totalSold === 0 && daysSinceAdded > 30) {
          recommendation = 'Consider discontinuing'
          recColor = 'text-[var(--danger)]'
        } else if (velocityPerDay < 0.01) {
          recommendation = 'Mark down or bundle'
          recColor = 'text-[var(--accent-gold)]'
        } else if (daysOfStock > 365) {
          recommendation = 'Reduce inventory'
          recColor = 'text-[var(--accent-gold)]'
        }

        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          brand: p.brand?.name || p.brand || '—',
          stockCount: p.stockCount || 0,
          totalSold,
          velocityPerDay: Math.round(velocityPerDay * 1000) / 1000,
          daysSinceAdded: Math.round(daysSinceAdded),
          recommendation,
          recColor,
          tiedUpValue: (p.regularPrice || 0) * (p.stockCount || 0),
        }
      })
      .sort((a, b) => a.velocityPerDay - b.velocityPerDay)
      .slice(0, 20)
  }, [products, orders])

  const totalTiedUp = slowSellers.reduce((s, p) => s + p.tiedUpValue, 0)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Slow Seller Analyzer
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {slowSellers.length} slow movers
        </span>
      </div>

      {slowSellers.length === 0 ? (
        <div className="text-center py-8">
          <Package size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] font-medium">No slow sellers found</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-[var(--surface-soft)] p-3 mb-4">
            <p className="text-[0.625rem] text-[var(--text-muted)]">Tied-up inventory value</p>
            <p className="font-mono text-sm font-bold text-[var(--danger)]">${totalTiedUp.toLocaleString()}</p>
          </div>

          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {slowSellers.map(p => (
              <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/products/${p.id}/edit`} className="text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--accent-gold)] truncate block">
                    {p.name}
                  </Link>
                  <p className="text-[0.625rem] text-[var(--text-muted)]">
                    {p.sku} · {p.brand} · {p.stockCount} in stock
                  </p>
                  <p className={`text-[0.625rem] font-bold ${p.recColor}`}>{p.recommendation}</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">{p.totalSold} sold</p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">{p.velocityPerDay}/day</p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">{p.daysSinceAdded}d listed</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
