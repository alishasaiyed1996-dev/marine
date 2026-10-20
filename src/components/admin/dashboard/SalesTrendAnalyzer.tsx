import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

function getWeekStart(date: string): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
  d.setUTCDate(diff)
  return d.toISOString().split('T')[0]
}

export function SalesTrendAnalyzer({ orders }: Props) {
  const data = useMemo(() => {
    // Group by week
    const weeklyRevenue: Record<string, number> = {}
    const weeklyOrders: Record<string, number> = {}
    const weeklyItems: Record<string, number> = {}

    for (const order of orders) {
      if (isCancelledOrRefunded(order) || !order.createdAt) continue
      const week = getWeekStart(order.createdAt)
      weeklyRevenue[week] = (weeklyRevenue[week] || 0) + (order.total || 0)
      weeklyOrders[week] = (weeklyOrders[week] || 0) + 1
      weeklyItems[week] = (weeklyItems[week] || 0) + (order.items?.length || 0)
    }

    // Get last 12 weeks
    const weeks: { date: string; revenue: number; orderCount: number; items: number; label: string }[] = []
    const today = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - (i * 7))
      const key = getWeekStart(d.toISOString())
      weeks.push({
        date: key,
        revenue: weeklyRevenue[key] || 0,
        orderCount: weeklyOrders[key] || 0,
        items: weeklyItems[key] || 0,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }

    const maxRevenue = Math.max(...weeks.map(w => w.revenue), 1)

    // Week-over-week comparison
    const lastWeek = weeks[weeks.length - 1]
    const prevWeek = weeks[weeks.length - 2]
    const wowChange = prevWeek.revenue > 0
      ? Math.round(((lastWeek.revenue - prevWeek.revenue) / prevWeek.revenue) * 100)
      : lastWeek.revenue > 0 ? 100 : 0

    // 4-week average
    const recent4 = weeks.slice(-4)
    const avg4WeekRevenue = recent4.reduce((s, w) => s + w.revenue, 0) / 4

    // Total period
    const totalRevenue = weeks.reduce((s, w) => s + w.revenue, 0)
    const totalOrders = weeks.reduce((s, w) => s + w.orderCount, 0)

    // Trend direction (simple linear regression slope sign)
    const nonZeroWeeks = weeks.filter(w => w.revenue > 0)
    let trendDirection: 'up' | 'down' | 'flat' = 'flat'
    if (nonZeroWeeks.length >= 2) {
      const firstHalf = nonZeroWeeks.slice(0, Math.floor(nonZeroWeeks.length / 2))
      const secondHalf = nonZeroWeeks.slice(Math.floor(nonZeroWeeks.length / 2))
      const avgFirst = firstHalf.reduce((s, w) => s + w.revenue, 0) / firstHalf.length
      const avgSecond = secondHalf.reduce((s, w) => s + w.revenue, 0) / secondHalf.length
      if (avgSecond > avgFirst * 1.1) trendDirection = 'up'
      else if (avgSecond < avgFirst * 0.9) trendDirection = 'down'
    }

    return { weeks, maxRevenue, wowChange, avg4WeekRevenue, totalRevenue, totalOrders, trendDirection }
  }, [orders])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Sales Trend Analyzer
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {data.trendDirection === 'up' ? <TrendingUp size={14} className="text-[var(--success)]" /> :
           data.trendDirection === 'down' ? <TrendingDown size={14} className="text-[var(--danger)]" /> :
           <Minus size={14} className="text-[var(--text-muted)]" />}
          <span className={`text-[0.625rem] font-bold ${
            data.trendDirection === 'up' ? 'text-[var(--success)]' :
            data.trendDirection === 'down' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
          }`}>
            {data.trendDirection === 'up' ? 'Trending Up' : data.trendDirection === 'down' ? 'Trending Down' : 'Stable'}
          </span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-28 mb-2">
        {data.weeks.map(w => (
          <div key={w.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10">
              <div className="rounded-lg bg-[var(--navy-deep)] text-white px-2 py-1 text-[0.5rem] font-bold whitespace-nowrap shadow-lg">
                ${w.revenue.toLocaleString()} · {w.orderCount} orders
              </div>
            </div>
            <div className="w-full rounded-t-sm bg-gradient-to-t from-[var(--accent-blue)] to-[var(--accent-blue)]/60 hover:from-[var(--accent-teal)] hover:to-[var(--accent-teal)]/60 transition-all min-h-[2px]"
              style={{ height: `${w.revenue > 0 ? Math.max((w.revenue / data.maxRevenue) * 100, 4) : 0}%` }}
              title={`${w.label}: $${w.revenue.toLocaleString()}`} />
          </div>
        ))}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-1 mb-4">
        {data.weeks.map((w, i) => (
          <div key={w.date} className="flex-1 text-center">
            {(i % 3 === 0 || i === data.weeks.length - 1) && (
              <span className="text-[0.4rem] text-[var(--text-muted)]">{w.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[var(--surface-soft)] p-2 text-center">
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">This Week</p>
          <p className="font-mono text-sm font-bold text-[var(--text-primary)]">
            ${data.weeks[data.weeks.length - 1]?.revenue.toLocaleString() || '0'}
          </p>
          <p className={`text-[0.5rem] font-bold ${
            data.wowChange > 0 ? 'text-[var(--success)]' : data.wowChange < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
          }`}>
            {data.wowChange > 0 ? '+' : ''}{data.wowChange}% vs last week
          </p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] p-2 text-center">
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">4-Wk Avg</p>
          <p className="font-mono text-sm font-bold text-[var(--text-primary)]">
            ${Math.round(data.avg4WeekRevenue).toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] p-2 text-center">
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">12-Wk Total</p>
          <p className="font-mono text-sm font-bold text-[var(--text-primary)]">
            ${data.totalRevenue.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}
