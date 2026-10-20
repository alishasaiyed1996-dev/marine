import { useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function DemandForecastEngine({ products, orders }: Props) {
  const [topN, setTopN] = useState(10)

  const forecast = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000

    // Build per-product daily sales
    const productDailySales = new Map<string, Map<string, number>>()
    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const orderDate = order.createdAt?.slice(0, 10)
      if (!orderDate) continue
      for (const item of order.items || []) {
        const pid = item.productId
        if (!pid) continue
        if (!productDailySales.has(pid)) productDailySales.set(pid, new Map())
        const dailyMap = productDailySales.get(pid)!
        dailyMap.set(orderDate, (dailyMap.get(orderDate) || 0) + (item.quantity || 1))
      }
    }

    const productMap = new Map(products.map((p: any) => [p.id, p]))

    // Calculate forecast per product
    const results = Array.from(productDailySales.entries()).map(([pid, dailyMap]) => {
      const product = productMap.get(pid)
      const days = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      const totalSold = days.reduce((s, [, v]) => s + v, 0)
      const totalDays = Math.max(1, (now - new Date(days[0]?.[0] || Date.now()).getTime()) / DAY)

      // 7-day moving average
      const last7 = days.slice(-7)
      const ma7 = last7.reduce((s, [, v]) => s + v, 0) / 7

      // 30-day moving average
      const last30 = days.slice(-30)
      const ma30 = last30.reduce((s, [, v]) => s + v, 0) / 30

      // Overall daily average
      const dailyAvg = totalSold / totalDays

      // Trend: compare last 7 days vs previous 7 days
      const prev7 = days.slice(-14, -7)
      const prev7Avg = prev7.length > 0 ? prev7.reduce((s, [, v]) => s + v, 0) / 7 : 0
      const trendPct = prev7Avg > 0 ? ((ma7 - prev7Avg) / prev7Avg) * 100 : ma7 > 0 ? 100 : 0

      // Day-of-week seasonality (if enough data)
      const dowTotals = [0, 0, 0, 0, 0, 0, 0]
      const dowCounts = [0, 0, 0, 0, 0, 0, 0]
      for (const [date, qty] of days) {
        const dow = new Date(date).getUTCDay()
        dowTotals[dow] += qty
        dowCounts[dow]++
      }
      const dowAvg = dowTotals.map((t, i) => dowCounts[i] > 0 ? t / dowCounts[i] : dailyAvg)
      const maxDow = Math.max(...dowAvg)
      const seasonalPeak = dowAvg.indexOf(maxDow)
      const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

      // Forecast next 30 days
      const forecast30 = Math.round(ma7 * 30)

      // Demand level
      let demandLevel: 'high' | 'medium' | 'low' | 'none' = 'none'
      if (ma7 >= 1) demandLevel = 'high'
      else if (ma7 >= 0.3) demandLevel = 'medium'
      else if (ma7 > 0) demandLevel = 'low'

      return {
        id: pid,
        name: product?.name || 'Unknown',
        sku: product?.sku || pid,
        brand: product?.brand?.name || product?.brand || '—',
        stockCount: product?.stockCount || 0,
        totalSold, dailyAvg: Math.round(dailyAvg * 100) / 100,
        ma7: Math.round(ma7 * 100) / 100,
        ma30: Math.round(ma30 * 100) / 100,
        trendPct: Math.round(trendPct),
        seasonPeak: dowNames[seasonalPeak],
        forecast30, demandLevel,
      }
    }).sort((a, b) => b.forecast30 - a.forecast30)

    return results
  }, [products, orders])

  const demandConfig = {
    high: { color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', label: 'High Demand' },
    medium: { color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', label: 'Medium' },
    low: { color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', label: 'Low' },
    none: { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-soft)]', label: 'No Sales' },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Demand Forecast Engine</h2>
        </div>
        <div className="flex gap-1">
          {[10, 20, 30].map(n => (
            <button key={n} onClick={() => setTopN(n)}
              className={`rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${
                topN === n ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
              }`}>Top {n}</button>
          ))}
        </div>
      </div>

      {forecast.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No order data for demand forecasting</p>
      ) : (
        <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
          {forecast.slice(0, topN).map((f, idx) => {
            const cfg = demandConfig[f.demandLevel]
            return (
              <div key={f.id} className="rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.5rem] font-bold text-[var(--text-muted)] w-4">#{idx + 1}</span>
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                    {f.trendPct !== 0 && (
                      <span className={`text-[0.5rem] font-bold ${f.trendPct > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                        {f.trendPct > 0 ? '↑' : '↓'}{Math.abs(f.trendPct)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-[0.5rem] text-[var(--text-muted)] ml-6">
                  <span>MA7: {f.ma7}/day · 30d forecast: {f.forecast30} units</span>
                  <span>Peak: {f.seasonPeak} · Stock: {f.stockCount}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
