import { useMemo } from 'react'
import { Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
  rfqs: any[]
}

export function DailySnapshot({ orders, rfqs }: Props) {
  const snapshot = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const todayStr = today.toISOString().split('T')[0]
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const todayOrders = orders.filter(o => o.createdAt?.startsWith(todayStr) && !isCancelledOrRefunded(o))
    const yesterdayOrders = orders.filter(o => o.createdAt?.startsWith(yesterdayStr) && !isCancelledOrRefunded(o))

    const todayRevenue = todayOrders.reduce((s, o) => s + (o.total || 0), 0)
    const yesterdayRevenue = yesterdayOrders.reduce((s, o) => s + (o.total || 0), 0)

    const todayRfqs = rfqs.filter(r => r.createdAt?.startsWith(todayStr))
    const yesterdayRfqs = rfqs.filter(r => r.createdAt?.startsWith(yesterdayStr))

    const todayEmergency = rfqs.filter(r => r.createdAt?.startsWith(todayStr) && r.urgency === 'emergency')
    const yesterdayEmergency = rfqs.filter(r => r.createdAt?.startsWith(yesterdayStr) && r.urgency === 'emergency')

    function diff(today: number, yesterday: number): { value: number; direction: 'up' | 'down' | 'flat' } {
      if (yesterday === 0 && today === 0) return { value: 0, direction: 'flat' }
      if (yesterday === 0) return { value: 100, direction: 'up' }
      const pct = ((today - yesterday) / yesterday) * 100
      return {
        value: Math.abs(Math.round(pct)),
        direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
      }
    }

    return {
      metrics: [
        { label: 'Revenue', today: `$${todayRevenue.toLocaleString()}`, diff: diff(todayRevenue, yesterdayRevenue) },
        { label: 'Orders', today: String(todayOrders.length), diff: diff(todayOrders.length, yesterdayOrders.length) },
        { label: 'RFQs', today: String(todayRfqs.length), diff: diff(todayRfqs.length, yesterdayRfqs.length) },
        { label: 'Emergency', today: String(todayEmergency.length), diff: diff(todayEmergency.length, yesterdayEmergency.length) },
      ],
    }
  }, [orders, rfqs])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Daily Snapshot
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          vs yesterday
        </span>
      </div>

      <div className="space-y-3">
        {snapshot.metrics.map(m => {
          const DiffIcon =
            m.diff.direction === 'up' ? TrendingUp :
            m.diff.direction === 'down' ? TrendingDown : Minus
          const diffColor =
            m.diff.direction === 'up' ? 'text-[var(--success)]' :
            m.diff.direction === 'down' ? 'text-[var(--danger)]' :
            'text-[var(--text-muted)]'

          return (
            <div key={m.label} className="flex items-center justify-between py-1.5 border-b border-[var(--border)] last:border-0">
              <span className="text-xs text-[var(--text-secondary)] font-medium">{m.label}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                  {m.today}
                </span>
                <span className={`flex items-center gap-0.5 text-[0.625rem] font-bold ${diffColor}`}>
                  <DiffIcon size={10} />
                  {m.diff.value > 0 ? `${m.diff.value}%` : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
