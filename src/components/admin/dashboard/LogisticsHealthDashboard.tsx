import { useMemo } from 'react'
import { Truck, CheckCircle, Clock, AlertTriangle, MapPin } from 'lucide-react'
import { orderDeliveredAt } from './orderFields'

interface Props {
  orders: any[]
}

export function LogisticsHealthDashboard({ orders }: Props) {
  const data = useMemo(() => {
    const shipped = orders.filter((o: any) => ['shipped', 'delivered'].includes(o.status))
    const delivered = orders.filter((o: any) => o.status === 'delivered')
    const cancelled = orders.filter((o: any) => o.status === 'cancelled')

    // Delivery time analysis
    const deliveryTimes: number[] = []
    for (const order of delivered) {
      const deliveredAt = orderDeliveredAt(order)
      if (order.createdAt && deliveredAt) {
        const days = (new Date(deliveredAt).getTime() - new Date(order.createdAt).getTime()) / 86400000
        if (days > 0 && days < 120) deliveryTimes.push(days)
      }
    }

    const avgDeliveryDays = deliveryTimes.length > 0
      ? deliveryTimes.reduce((s, d) => s + d, 0) / deliveryTimes.length : 0
    const minDays = deliveryTimes.length > 0 ? Math.min(...deliveryTimes) : 0
    const maxDays = deliveryTimes.length > 0 ? Math.max(...deliveryTimes) : 0
    const medianDays = deliveryTimes.length > 0
      ? [...deliveryTimes].sort((a, b) => a - b)[Math.floor(deliveryTimes.length / 2)] : 0

    // On-time rate (delivered within 7 days)
    const onTimeCount = deliveryTimes.filter(d => d <= 7).length
    const onTimeRate = deliveryTimes.length > 0 ? (onTimeCount / deliveryTimes.length) * 100 : 0

    // Carrier breakdown
    const carriers: Record<string, { count: number; avgDays: number; times: number[] }> = {}
    for (const order of shipped) {
      const carrier = order.courier || 'Standard'
      if (!carriers[carrier]) carriers[carrier] = { count: 0, avgDays: 0, times: [] }
      carriers[carrier].count++
      const deliveredAt = orderDeliveredAt(order)
      if (deliveredAt && order.createdAt) {
        const days = (new Date(deliveredAt).getTime() - new Date(order.createdAt).getTime()) / 86400000
        if (days > 0) carriers[carrier].times.push(days)
      }
    }
    const carrierList = Object.entries(carriers).map(([name, data]) => ({
      name, count: data.count,
      avgDays: data.times.length > 0 ? data.times.reduce((s, d) => s + d, 0) / data.times.length : 0,
    })).sort((a, b) => b.count - a.count)

    // Destination analysis
    const destinations: Record<string, number> = {}
    for (const order of shipped) {
      const dest = order.shippingCountry || order.country || 'Unknown'
      destinations[dest] = (destinations[dest] || 0) + 1
    }
    const topDestinations = Object.entries(destinations).sort((a, b) => b[1] - a[1]).slice(0, 5)

    // Delivery time distribution
    const buckets = [
      { label: '1-2 days', min: 0, max: 2, count: 0, color: 'bg-[var(--success)]' },
      { label: '3-5 days', min: 2, max: 5, count: 0, color: 'bg-[var(--accent-teal)]' },
      { label: '6-7 days', min: 5, max: 7, count: 0, color: 'bg-[var(--accent-gold)]' },
      { label: '8-14 days', min: 7, max: 14, count: 0, color: 'bg-[var(--accent-gold)]' },
      { label: '15+ days', min: 14, max: Infinity, count: 0, color: 'bg-[var(--danger)]' },
    ]
    for (const d of deliveryTimes) {
      const bucket = buckets.find(b => d > b.min && d <= b.max)
      if (bucket) bucket.count++
    }

    // Return/cancellation rate
    const cancelRate = orders.length > 0 ? (cancelled.length / orders.length) * 100 : 0

    return {
      totalShipped: shipped.length, totalDelivered: delivered.length,
      avgDeliveryDays, minDays, maxDays, medianDays, onTimeRate,
      carrierList, topDestinations, buckets, cancelRate,
      deliveryTimeCount: deliveryTimes.length,
    }
  }, [orders])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Truck size={16} className="text-[var(--accent-blue)]" />
        <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Logistics Health Dashboard</h2>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Avg Delivery', value: `${data.avgDeliveryDays.toFixed(1)}d`, icon: Clock, color: 'text-[var(--accent-blue)]' },
          { label: 'On-Time Rate', value: `${data.onTimeRate.toFixed(0)}%`, icon: CheckCircle, color: data.onTimeRate >= 80 ? 'text-[var(--success)]' : 'text-[var(--danger)]' },
          { label: 'Cancel Rate', value: `${data.cancelRate.toFixed(1)}%`, icon: AlertTriangle, color: data.cancelRate > 15 ? 'text-[var(--danger)]' : 'text-[var(--accent-teal)]' },
        ].map(m => {
          const Icon = m.icon
          return (
            <div key={m.label} className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
              <Icon size={14} className={`mx-auto mb-1 ${m.color}`} />
              <p className="font-mono text-sm font-extrabold text-[var(--text-primary)]">{m.value}</p>
              <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">{m.label}</p>
            </div>
          )
        })}
      </div>

      {/* Delivery time distribution */}
      <div className="mb-4">
        <h3 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Delivery Time Distribution</h3>
        <div className="space-y-1.5">
          {data.buckets.map(b => {
            const pct = data.deliveryTimeCount > 0 ? (b.count / data.deliveryTimeCount) * 100 : 0
            return (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[0.625rem] text-[var(--text-secondary)]">{b.label}</span>
                  <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">{b.count} ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-soft)] overflow-hidden">
                  <div className={`h-full rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Carrier performance */}
      {data.carrierList.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Carrier Performance</h3>
          <div className="space-y-1">
            {data.carrierList.map(c => (
              <div key={c.name} className="flex items-center justify-between rounded-lg bg-[var(--surface-soft)] px-3 py-1.5">
                <span className="text-xs font-medium text-[var(--text-secondary)]">{c.name}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">{c.count} shipments</span>
                  <span className="text-[0.5rem] text-[var(--text-muted)]">Avg {c.avgDays.toFixed(1)}d</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top destinations */}
      {data.topDestinations.length > 0 && (
        <div>
          <h3 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Top Destinations</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.topDestinations.map(([country, count]) => (
              <span key={country} className="flex items-center gap-1 rounded-lg bg-[var(--surface-soft)] px-2 py-1 text-[0.625rem] font-medium text-[var(--text-secondary)]">
                <MapPin size={8} /> {country} ({count})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
