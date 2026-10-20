import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react'
import { orderItemLineTotal } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function ProductTrendRadar({ products, orders }: Props) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d')

  const trends = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const halfPeriod = Math.floor(periodDays / 2)

    const cutoff = now - periodDays * DAY
    const midPoint = now - halfPeriod * DAY

    const productOrders = new Map<string, { firstHalf: number; secondHalf: number; total: number; revenue: number }>()

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const orderTime = new Date(order.createdAt).getTime()
      if (orderTime < cutoff) continue

      for (const item of order.items || []) {
        const pid = item.productId
        if (!pid) continue
        if (!productOrders.has(pid)) {
          productOrders.set(pid, { firstHalf: 0, secondHalf: 0, total: 0, revenue: 0 })
        }
        const data = productOrders.get(pid)!
        const qty = item.quantity || 1
        data.total += qty
        data.revenue += orderItemLineTotal(item)
        if (orderTime >= midPoint) data.secondHalf += qty
        else data.firstHalf += qty
      }
    }

    const productMap = new Map(products.map((p: any) => [p.id, p]))

    return Array.from(productOrders.entries()).map(([pid, data]) => {
      const product = productMap.get(pid)
      const firstHalfAvg = data.firstHalf / halfPeriod
      const secondHalfAvg = data.secondHalf / (periodDays - halfPeriod)
      const velocityChange = firstHalfAvg > 0
        ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100
        : secondHalfAvg > 0 ? 100 : 0

      return {
        id: pid,
        name: product?.name || 'Unknown Product',
        sku: product?.sku || pid,
        brand: product?.brand?.name || product?.brand || '—',
        totalSold: data.total,
        revenue: data.revenue,
        velocityChange: Math.round(velocityChange),
        firstHalf: data.firstHalf,
        secondHalf: data.secondHalf,
      }
    }).sort((a, b) => b.velocityChange - a.velocityChange)
  }, [products, orders, period])

  const trending = trends.filter(t => t.velocityChange > 20)
  const declining = trends.filter(t => t.velocityChange < -20)
  const stable = trends.filter(t => Math.abs(t.velocityChange) <= 20)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Product Trend Radar</h2>
        </div>
        <div className="flex gap-1">
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${
                period === p ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
              }`}>{p}</button>
          ))}
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 mb-4">
        {trending.length > 0 && (
          <span className="rounded-lg bg-[var(--success)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--success)] flex items-center gap-1">
            <TrendingUp size={10} /> {trending.length} trending
          </span>
        )}
        {declining.length > 0 && (
          <span className="rounded-lg bg-[var(--danger)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--danger)] flex items-center gap-1">
            <TrendingDown size={10} /> {declining.length} declining
          </span>
        )}
        {stable.length > 0 && (
          <span className="rounded-lg bg-[var(--surface-soft)] px-2 py-1 text-[0.625rem] font-bold text-[var(--text-muted)] flex items-center gap-1">
            <Minus size={10} /> {stable.length} stable
          </span>
        )}
      </div>

      {/* Product list */}
      {trends.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No product sales data in this period</p>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {trends.slice(0, 20).map(t => {
            const isUp = t.velocityChange > 20
            const isDown = t.velocityChange < -20
            return (
              <div key={t.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{t.name}</p>
                  <p className="text-[0.625rem] text-[var(--text-muted)]">{t.sku} · {t.brand}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <div className="text-right">
                    <p className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${t.revenue.toLocaleString()}</p>
                    <p className="text-[0.5rem] text-[var(--text-muted)]">{t.totalSold} sold</p>
                  </div>
                  <div className={`flex items-center gap-0.5 rounded-lg px-2 py-1 ${
                    isUp ? 'bg-[var(--success)]/10 text-[var(--success)]'
                    : isDown ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
                    : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
                  }`}>
                    {isUp ? <TrendingUp size={10} /> : isDown ? <TrendingDown size={10} /> : <Minus size={10} />}
                    <span className="font-mono text-[0.625rem] font-bold">
                      {t.velocityChange > 0 ? '+' : ''}{t.velocityChange}%
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
