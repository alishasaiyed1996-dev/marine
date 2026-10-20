import { useMemo, useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import { orderCustomerEmail } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

interface FraudAlert {
  id: string
  type: string
  description: string
  severity: 'critical' | 'high' | 'medium'
  orderId?: string
  email?: string
  amount?: number
  evidence: string
}

export function FraudDetectionCenter({ orders }: Props) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all')

  const analysis = useMemo(() => {
    const alerts: FraudAlert[] = []

    // 1. Velocity checks — multiple orders from same email in short time
    const emailOrders: Record<string, Array<{ order: any; time: number }>> = {}
    for (const order of orders) {
      const email = orderCustomerEmail(order)
      if (!email) continue
      if (!emailOrders[email]) emailOrders[email] = []
      emailOrders[email].push({ order, time: new Date(order.createdAt).getTime() })
    }

    for (const [email, entries] of Object.entries(emailOrders)) {
      // Check 1-hour window. Find the busiest window once per customer —
      // previously every order in the same cluster emitted an identical alert.
      entries.sort((a, b) => a.time - b.time)
      let busiest: typeof entries = []
      for (let i = 0; i < entries.length; i++) {
        const window = entries.slice(i).filter((e) => e.time - entries[i].time < 3600000)
        if (window.length > busiest.length) busiest = window
      }
      if (busiest.length >= 4) {
        const totalValue = busiest.reduce((s, e) => s + (e.order.total || 0), 0)
        alerts.push({
          id: `vel-${email}`,
          type: 'velocity',
          description: `${busiest.length} orders in 1 hour`,
          severity: totalValue > 5000 ? 'critical' : 'high',
          email, amount: totalValue,
          evidence: `Total value: $${totalValue.toLocaleString()} across ${busiest.length} orders`,
        })
      }

      // Check cancellation pattern
      const cancelled = entries.filter(e => e.order.status === 'cancelled')
      if (cancelled.length >= 3 && cancelled.length > entries.length * 0.5) {
        alerts.push({
          id: `cancel-${email}`,
          type: 'cancel_pattern',
          description: `${cancelled.length}/${entries.length} orders cancelled (${Math.round((cancelled.length / entries.length) * 100)}%)`,
          severity: 'high',
          email,
          evidence: 'High cancellation rate suggests testing or fraudulent activity',
        })
      }
    }

    // 2. Unusually high order values
    const liveOrders = orders.filter((o) => !isCancelledOrRefunded(o))
    const orderValues = liveOrders.map(o => o.total || 0).filter(v => v > 0)
    const avgValue = orderValues.length > 0 ? orderValues.reduce((s, v) => s + v, 0) / orderValues.length : 0
    const stdDev = orderValues.length > 0
      ? Math.sqrt(orderValues.reduce((s, v) => s + (v - avgValue) ** 2, 0) / orderValues.length)
      : 0

    for (const order of liveOrders) {
      if (order.total > avgValue + 3 * stdDev && order.total > 5000) {
        alerts.push({
          id: `outlier-${order.id}`,
          type: 'outlier',
          description: `Order value $${order.total.toLocaleString()} is ${(order.total / Math.max(1, avgValue)).toFixed(1)}x average`,
          severity: 'medium',
          orderId: order.id,
          email: orderCustomerEmail(order),
          amount: order.total,
          evidence: `Average order: $${Math.round(avgValue).toLocaleString()}, this order: $${order.total.toLocaleString()}`,
        })
      }
    }

    // 3. Rush/shipping anomalies
    for (const order of orders) {
      if (order.total > 3000 && ['pending', 'confirmed'].includes(order.status)) {
        const age = (Date.now() - new Date(order.createdAt).getTime()) / 3600000
        if (age < 1) {
          alerts.push({
            id: `rush-${order.id}`,
            type: 'rush',
            description: `High-value order ($${order.total.toLocaleString()}) placed < 1 hour ago`,
            severity: 'medium',
            orderId: order.id,
            email: orderCustomerEmail(order),
            amount: order.total,
            evidence: 'New high-value order — verify payment before shipping',
          })
        }
      }
    }

    // 4. Duplicate amounts
    const amountMap: Record<number, string[]> = {}
    for (const order of liveOrders) {
      if (!order.total || order.total === 0) continue
      const key = Math.round(order.total * 100) / 100
      if (!amountMap[key]) amountMap[key] = []
      amountMap[key].push(order.id)
    }
    for (const [amount, ids] of Object.entries(amountMap)) {
      if (ids.length >= 3) {
        alerts.push({
          id: `dup-${amount}`,
          type: 'duplicate',
          description: `${ids.length} orders with identical amount $${parseFloat(amount).toLocaleString()}`,
          severity: 'medium',
          amount: parseFloat(amount),
          evidence: `Order IDs: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '...' : ''}`,
        })
      }
    }

    const sorted = alerts.sort((a, b) => {
      const sev = { critical: 3, high: 2, medium: 1 }
      return sev[b.severity] - sev[a.severity]
    })

    return {
      alerts: sorted,
      critical: sorted.filter(a => a.severity === 'critical').length,
      high: sorted.filter(a => a.severity === 'high').length,
      medium: sorted.filter(a => a.severity === 'medium').length,
      riskScore: sorted.length === 0 ? 0 : Math.min(100, sorted.filter(a => a.severity === 'critical').length * 30 + sorted.filter(a => a.severity === 'high').length * 15 + sorted.length * 5),
    }
  }, [orders])

  const filtered = filter === 'all' ? analysis.alerts : analysis.alerts.filter(a => a.severity === filter)

  const severityConfig = {
    critical: { color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', label: 'Critical' },
    high: { color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', label: 'High' },
    medium: { color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', label: 'Medium' },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertOctagon size={16} className="text-[var(--danger)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Fraud Detection Center</h2>
        </div>
        <div className={`rounded-lg px-2 py-1 text-[0.625rem] font-bold ${
          analysis.riskScore >= 50 ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
          : analysis.riskScore >= 20 ? 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]'
          : 'bg-[var(--success)]/10 text-[var(--success)]'
        }`}>
          Risk Score: {analysis.riskScore}/100
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 mb-4">
        {[
          { label: 'Critical', count: analysis.critical, color: 'text-[var(--danger)]' },
          { label: 'High', count: analysis.high, color: 'text-[var(--accent-gold)]' },
          { label: 'Medium', count: analysis.medium, color: 'text-[var(--accent-blue)]' },
        ].map(s => (
          <button key={s.label} onClick={() => setFilter(filter === s.label.toLowerCase() ? 'all' : s.label.toLowerCase() as 'all' | 'critical' | 'high' | 'medium')}
            className={`rounded-lg px-2 py-1 text-[0.625rem] font-bold transition-all ${
              filter === s.label.toLowerCase() ? `${s.color} ring-2 ring-current/20 bg-[var(--surface-soft)]` : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
            }`}>
            {s.count} {s.label}
          </button>
        ))}
      </div>

      {/* Alerts */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <AlertOctagon size={24} className="mx-auto text-[var(--success)] mb-2" />
          <p className="text-xs text-[var(--success)] font-medium">No fraud alerts detected</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {filtered.map(alert => {
            const cfg = severityConfig[alert.severity]
            return (
              <div key={alert.id} className="rounded-xl border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${cfg.bg} ${cfg.color} shrink-0`}>
                    {cfg.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{alert.description}</p>
                    <p className="text-[0.625rem] text-[var(--text-muted)] mt-0.5">{alert.evidence}</p>
                    {alert.orderId && <p className="text-[0.5rem] text-[var(--text-muted)] mt-0.5">Order: {alert.orderId}</p>}
                  </div>
                  {alert.amount && (
                    <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)] shrink-0">
                      ${alert.amount.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
