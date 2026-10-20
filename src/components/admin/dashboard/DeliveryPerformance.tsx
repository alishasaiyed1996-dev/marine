import { useMemo } from 'react'
import { Truck, Clock, CheckCircle, TrendingUp } from 'lucide-react'
import { orderDeliveredAt } from './orderFields'

interface Props {
  orders: any[]
}

export function DeliveryPerformance({ orders }: Props) {
  const stats = useMemo(() => {
    const delivered = orders.filter(o =>
      o.status === 'delivered' && o.createdAt && orderDeliveredAt(o)
    )

    const deliveryTimes = delivered.map(o => {
      const created = new Date(o.createdAt).getTime()
      const deliveredAt = new Date(orderDeliveredAt(o) as string).getTime()
      return Math.round((deliveredAt - created) / 86400000)
    }).filter(d => d >= 0)

    const avgDays = deliveryTimes.length > 0
      ? Math.round(deliveryTimes.reduce((s, d) => s + d, 0) / deliveryTimes.length)
      : 0
    const onTimeCount = deliveryTimes.filter(d => d <= 7).length
    const onTimeRate = deliveryTimes.length > 0
      ? Math.round((onTimeCount / deliveryTimes.length) * 100)
      : 0
    const maxDays = deliveryTimes.length > 0 ? Math.max(...deliveryTimes) : 0
    const minDays = deliveryTimes.length > 0 ? Math.min(...deliveryTimes) : 0

    // Distribution buckets
    const buckets = [
      { label: '1-2 days', count: deliveryTimes.filter(d => d <= 2).length, color: 'bg-[var(--success)]' },
      { label: '3-5 days', count: deliveryTimes.filter(d => d >= 3 && d <= 5).length, color: 'bg-[var(--accent-blue)]' },
      { label: '6-7 days', count: deliveryTimes.filter(d => d >= 6 && d <= 7).length, color: 'bg-[var(--accent-gold)]' },
      { label: '8+ days', count: deliveryTimes.filter(d => d >= 8).length, color: 'bg-[var(--danger)]' },
    ]
    const maxBucket = Math.max(...buckets.map(b => b.count), 1)

    return { deliveredCount: delivered.length, avgDays, onTimeRate, maxDays, minDays, deliveryTimes, buckets, maxBucket }
  }, [orders])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Delivery Performance
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {stats.deliveredCount} deliveries
        </span>
      </div>

      {stats.deliveredCount === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No delivered orders yet</p>
      ) : (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
              <Clock size={14} className="mx-auto text-[var(--accent-blue)] mb-1" />
              <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">{stats.avgDays}</p>
              <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Avg Days</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
              <CheckCircle size={14} className="mx-auto text-[var(--success)] mb-1" />
              <p className={`font-mono text-lg font-extrabold ${stats.onTimeRate >= 80 ? 'text-[var(--success)]' : stats.onTimeRate >= 60 ? 'text-[var(--accent-gold)]' : 'text-[var(--danger)]'}`}>
                {stats.onTimeRate}%
              </p>
              <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">On-Time</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
              <TrendingUp size={14} className="mx-auto text-[var(--accent-teal)] mb-1" />
              <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">
                {stats.minDays}-{stats.maxDays}
              </p>
              <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Range (days)</p>
            </div>
          </div>

          {/* Distribution bars */}
          <div className="space-y-2">
            <h3 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Delivery Time Distribution
            </h3>
            {stats.buckets.map(b => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[0.625rem] text-[var(--text-muted)] w-16 shrink-0">{b.label}</span>
                <div className="flex-1 h-3 rounded-full bg-[var(--surface-soft)] overflow-hidden">
                  <div className={`h-full rounded-full ${b.color} transition-all duration-500`}
                    style={{ width: `${(b.count / stats.maxBucket) * 100}%` }} />
                </div>
                <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)] w-6 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
