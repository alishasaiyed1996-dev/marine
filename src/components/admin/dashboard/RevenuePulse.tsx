import { useMemo } from 'react'
import { TrendingUp, Calendar } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

export function RevenuePulse({ orders }: Props) {
  const chartData = useMemo(() => {
    const revenueByDate: Record<string, number> = {}

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const date = order.createdAt?.split('T')[0]
      if (date) {
        revenueByDate[date] = (revenueByDate[date] || 0) + (order.total || 0)
      }
    }

    // Get last 14 days
    const days: { date: string; revenue: number; label: string }[] = []
    const today = new Date()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      days.push({
        date: key,
        revenue: revenueByDate[key] || 0,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }

    const maxRevenue = Math.max(...days.map(d => d.revenue), 1)
    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0)
    const avgDaily = totalRevenue / days.filter(d => d.revenue > 0).length || 0
    const peakDay = days.reduce((max, d) => d.revenue > max.revenue ? d : max, days[0])

    return { days, maxRevenue, totalRevenue, avgDaily, peakDay }
  }, [orders])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Revenue Pulse
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium flex items-center gap-1">
          <Calendar size={10} /> Last 14 days
        </span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-32 mb-3">
        {chartData.days.map(d => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div
              className="w-full rounded-t-sm bg-gradient-to-t from-[var(--accent-gold)] to-[var(--accent-gold)]/60 transition-all duration-300 hover:from-[var(--accent-teal)] hover:to-[var(--accent-teal)]/60 min-h-[2px]"
              style={{ height: `${d.revenue > 0 ? Math.max((d.revenue / chartData.maxRevenue) * 100, 4) : 0}%` }}
              title={`${d.label}: $${d.revenue.toLocaleString()}`}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="rounded-lg bg-[var(--navy-deep)] text-white px-2 py-1 text-[0.5rem] font-bold whitespace-nowrap shadow-lg">
                ${d.revenue.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1 mb-3">
        {chartData.days.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {(i % 3 === 0 || i === chartData.days.length - 1) && (
              <span className="text-[0.5rem] text-[var(--text-muted)]">{d.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Summary stats */}
      <div className="flex items-center justify-between text-xs border-t border-[var(--border)] pt-3">
        <div>
          <span className="text-[var(--text-muted)]">Total: </span>
          <span className="font-mono font-bold text-[var(--text-primary)]">
            ${chartData.totalRevenue.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Avg: </span>
          <span className="font-mono font-bold text-[var(--text-primary)]">
            ${Math.round(chartData.avgDaily).toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Peak: </span>
          <span className="font-mono font-bold text-[var(--accent-teal)]">
            ${chartData.peakDay.revenue.toLocaleString()}
          </span>
          <span className="text-[var(--text-muted)]"> ({chartData.peakDay.label})</span>
        </div>
      </div>
    </div>
  )
}
