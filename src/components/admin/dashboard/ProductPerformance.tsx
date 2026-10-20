import { useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { orderItemLineTotal } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function ProductPerformance({ products, orders }: Props) {
  const [quadrant, setQuadrant] = useState<'all' | 'stars' | 'rising' | 'cash-cow' | 'underperformer'>('all')

  const metrics = useMemo(() => {
    // Calculate per-product metrics
    const productMetrics = products.map((p: any) => {
      const productOrders = orders.filter(o =>
        !isCancelledOrRefunded(o) && (o.items || []).some((i: any) => i.productId === p.id)
      )
      const totalSold = productOrders.reduce((s: number, o: any) => {
        const item = (o.items || []).find((i: any) => i.productId === p.id)
        return s + (item?.quantity || 0)
      }, 0)
      const revenue = productOrders.reduce((s: number, o: any) => {
        const item = (o.items || []).find((i: any) => i.productId === p.id)
        return s + orderItemLineTotal(item)
      }, 0)
      const daysSinceAdded = Math.max(1, (Date.now() - new Date(p.createdAt || Date.now()).getTime()) / 86400000)
      const velocityPerDay = totalSold / daysSinceAdded

      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        brand: p.brand?.name || p.brand || '—',
        revenue,
        totalSold,
        stockCount: p.stockCount || 0,
        velocityPerDay: Math.round(velocityPerDay * 100) / 100,
        sellThroughRate: (p.stockCount || 0) + totalSold > 0
          ? Math.round((totalSold / ((p.stockCount || 0) + totalSold)) * 100)
          : 0,
      }
    }).filter(p => p.totalSold > 0 || p.stockCount > 0)

    // Calculate medians for quadrant splitting
    const revenues = productMetrics.map(p => p.revenue).sort((a, b) => a - b)
    const velocities = productMetrics.map(p => p.velocityPerDay).sort((a, b) => a - b)
    const medianRevenue = revenues[Math.floor(revenues.length / 2)] || 0
    const medianVelocity = velocities[Math.floor(velocities.length / 2)] || 0

    // Classify into quadrants
    const classified = productMetrics.map((p: any): typeof productMetrics[number] & { quadrant: 'stars' | 'rising' | 'cash-cow' | 'underperformer' } => {
      const highRevenue = p.revenue >= medianRevenue
      const highVelocity = p.velocityPerDay >= medianVelocity
      const quadrant = highRevenue && highVelocity ? 'stars' as const
        : !highRevenue && highVelocity ? 'rising' as const
        : highRevenue && !highVelocity ? 'cash-cow' as const
        : 'underperformer' as const
      return { ...p, quadrant }
    })

    return { products: classified, medianRevenue, medianVelocity }
  }, [products, orders])

  const quadrantConfig = {
    all: { label: 'All Products', count: metrics.products.length },
    stars: { label: '⭐ Stars', count: metrics.products.filter(p => p.quadrant === 'stars').length, color: 'text-[var(--accent-gold)]' },
    rising: { label: '🌱 Rising', count: metrics.products.filter(p => p.quadrant === 'rising').length, color: 'text-[var(--accent-teal)]' },
    'cash-cow': { label: '💎 Cash Cows', count: metrics.products.filter(p => p.quadrant === 'cash-cow').length, color: 'text-[var(--accent-blue)]' },
    underperformer: { label: '❓ Underperformers', count: metrics.products.filter(p => p.quadrant === 'underperformer').length, color: 'text-[var(--text-muted)]' },
  }

  const filtered = quadrant === 'all' ? metrics.products : metrics.products.filter(p => p.quadrant === quadrant)

  const quadrantColors = {
    stars: 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/5',
    rising: 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/5',
    'cash-cow': 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/5',
    underperformer: 'border-[var(--border)] bg-[var(--surface-soft)]',
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LayoutGrid size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Product Performance Matrix
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {metrics.products.length} products analyzed
        </span>
      </div>

      {/* Quadrant tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {(Object.keys(quadrantConfig) as Array<keyof typeof quadrantConfig>).map(key => {
          const cfg = quadrantConfig[key]
          return (
            <button key={key} onClick={() => setQuadrant(key)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
                quadrant === key ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}>
              {cfg.label} ({cfg.count})
            </button>
          )
        })}
      </div>

      {/* Quadrant grid visual */}
      {quadrant === 'all' && metrics.products.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(['stars', 'rising', 'cash-cow', 'underperformer'] as const).map(q => {
            const count = metrics.products.filter(p => p.quadrant === q).length
            return (
              <div key={q} className={`rounded-xl border p-2 text-center ${quadrantColors[q]}`}>
                <p className="text-[0.625rem] font-bold">{quadrantConfig[q].label}</p>
                <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">{count}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Product list */}
      {filtered.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No products in this category</p>
      ) : (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {filtered.slice(0, 20).map(p => (
            <div key={p.id} className={`flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors border ${quadrantColors[p.quadrant]}`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{p.name}</p>
                <p className="text-[0.625rem] text-[var(--text-muted)]">{p.sku} · {p.brand}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-2">
                <div className="text-right">
                  <p className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${p.revenue.toLocaleString()}</p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">{p.totalSold} sold</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[0.625rem] font-bold text-[var(--accent-gold)]">{p.sellThroughRate}%</p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">sell-through</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
