import { useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

const FLAGS: { [key: string]: string } = {
  'US': '🇺🇸', 'GB': '🇬🇧', 'AE': '🇦🇪', 'SA': '🇸🇦', 'IN': '🇮🇳',
  'SG': '🇸🇬', 'DE': '🇩🇪', 'NL': '🇳🇱', 'JP': '🇯🇵', 'KR': '🇰🇷',
  'CN': '🇨🇳', 'PH': '🇵🇭', 'ID': '🇮🇩', 'MY': '🇲🇾', 'TH': '🇹🇭',
  'BR': '🇧🇷', 'AU': '🇦🇺', 'CA': '🇨🇦', 'FR': '🇫🇷', 'IT': '🇮🇹',
  'EG': '🇪🇬', 'NG': '🇳🇬', 'QA': '🇶🇦', 'KW': '🇰🇼', 'BH': '🇧🇭',
  'OM': '🇴🇲', 'JO': '🇯🇴', 'TR': '🇹🇷', 'PK': '🇵🇰', 'BD': '🇧🇩',
}

export function RegionalHeatmap({ orders }: Props) {
  const [sortBy, setSortBy] = useState<'revenue' | 'count'>('revenue')

  const regions = useMemo(() => {
    const map: { [key: string]: { revenue: number; count: number } } = {}

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const country = order.shippingCountry || order.shipping?.country || order.country || order.customerCountry || 'Unknown'
      if (!map[country]) map[country] = { revenue: 0, count: 0 }
      map[country].revenue += order.total || 0
      map[country].count++
    }

    const result = Object.entries(map).map(([country, data]) => ({
      country,
      flag: FLAGS[country] || '🌍',
      revenue: data.revenue,
      count: data.count,
    }))

    if (sortBy === 'revenue') result.sort((a, b) => b.revenue - a.revenue)
    else result.sort((a, b) => b.count - a.count)

    return result
  }, [orders, sortBy])

  const maxValue = regions.length > 0
    ? Math.max(...regions.map(r => sortBy === 'revenue' ? r.revenue : r.count))
    : 1

  const totalRevenue = regions.reduce((s, r) => s + r.revenue, 0)
  const totalOrders = regions.reduce((s, r) => s + r.count, 0)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Regional Sales Heatmap
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {regions.length} regions
        </span>
      </div>

      {/* Sort toggle */}
      <div className="flex gap-1.5 mb-4">
        {(['revenue', 'count'] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
              sortBy === s ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}>
            {s === 'revenue' ? 'By Revenue' : 'By Orders'}
          </button>
        ))}
      </div>

      {regions.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No regional data yet</p>
      ) : (
        <>
          {/* Bar chart */}
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
            {regions.slice(0, 15).map(r => {
              const value = sortBy === 'revenue' ? r.revenue : r.count
              const width = maxValue > 0 ? (value / maxValue) * 100 : 0
              const percentage = totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 100) : 0

              return (
                <div key={r.country} className="flex items-center gap-2 group relative">
                  <span className="text-sm w-6 shrink-0">{r.flag}</span>
                  <span className="text-[0.625rem] text-[var(--text-secondary)] font-medium w-8 shrink-0">{r.country}</span>
                  <div className="flex-1 h-4 rounded-full bg-[var(--surface-soft)] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-teal)] transition-all duration-500"
                      style={{ width: `${width}%` }} />
                  </div>
                  <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)] w-16 text-right shrink-0">
                    {sortBy === 'revenue' ? `$${r.revenue.toLocaleString()}` : r.count}
                  </span>
                  {/* Tooltip */}
                  <div className="absolute right-0 bottom-full mb-1 hidden group-hover:block z-10">
                    <div className="rounded-lg bg-[var(--navy-deep)] text-white px-2 py-1 text-[0.5rem] font-bold whitespace-nowrap shadow-lg">
                      {r.flag} {r.country}: ${r.revenue.toLocaleString()} ({r.count} orders, {percentage}%)
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)] text-xs">
            <span className="text-[var(--text-muted)]">
              Total: <span className="font-mono font-bold text-[var(--text-primary)]">${totalRevenue.toLocaleString()}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              <span className="font-mono font-bold text-[var(--text-primary)]">{totalOrders}</span> orders
            </span>
          </div>
        </>
      )}
    </div>
  )
}
