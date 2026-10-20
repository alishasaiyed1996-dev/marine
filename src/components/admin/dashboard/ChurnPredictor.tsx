import { useMemo, useState } from 'react'
import { UserX, AlertTriangle, CheckCircle } from 'lucide-react'
import { orderCustomerEmail, orderCustomerName } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
  customers: any[]
}

export function ChurnPredictor({ orders, customers }: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'churned' | 'at-risk'>('all')

  const analyzed = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000
    const map = new Map<string, { name: string; totalSpend: number; orderCount: number; lastOrder: string }>()

    for (const order of orders) {
      // A cancelled/refunded order is not an active relationship signal.
      if (isCancelledOrRefunded(order)) continue
      const email = orderCustomerEmail(order)
      if (!email) continue
      if (!map.has(email)) {
        map.set(email, { name: orderCustomerName(order), totalSpend: 0, orderCount: 0, lastOrder: order.createdAt })
      }
      const c = map.get(email)!
      c.totalSpend += order.total || 0
      c.orderCount++
      if (order.createdAt > c.lastOrder) c.lastOrder = order.createdAt
    }

    // Also add customers from the customers API that don't have orders
    for (const cust of customers) {
      const email = cust.email || ''
      if (!email || map.has(email)) continue
      map.set(email, { name: cust.name || email.split('@')[0], totalSpend: 0, orderCount: 0, lastOrder: cust.lastLoginAt || cust.createdAt || new Date(0).toISOString() })
    }

    return Array.from(map.entries()).map(([email, data]) => {
      const daysSince = Math.round((now - new Date(data.lastOrder).getTime()) / DAY)
      const status = daysSince < 30 ? 'active' as const : daysSince < 60 ? 'at-risk' as const : 'churned' as const
      return { email, ...data, daysSince, status }
    }).sort((a, b) => b.daysSince - a.daysSince)
  }, [orders, customers])

  const counts = useMemo(() => ({
    active: analyzed.filter(c => c.status === 'active').length,
    atRisk: analyzed.filter(c => c.status === 'at-risk').length,
    churned: analyzed.filter(c => c.status === 'churned').length,
  }), [analyzed])

  const filtered = filter === 'all' ? analyzed : analyzed.filter(c => c.status === filter)

  const statusCfg = {
    active: { color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: CheckCircle, label: 'Active' },
    'at-risk': { color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: AlertTriangle, label: 'At Risk' },
    churned: { color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: UserX, label: 'Churned' },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserX size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Churn Predictor</h2>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(['active', 'atRisk', 'churned'] as const).map(key => {
          const status = key === 'atRisk' ? 'at-risk' : key
          const cfg = statusCfg[status]
          const Icon = cfg.icon
          return (
            <button key={key} onClick={() => setFilter(filter === status ? 'all' : status)}
              className={`rounded-xl p-3 text-center transition-all ${filter === status ? `${cfg.bg} ring-2 ring-current/20` : 'bg-[var(--surface-soft)] hover:bg-[var(--border)]'}`}>
              <Icon size={16} className={`mx-auto mb-1 ${cfg.color}`} />
              <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">{counts[key]}</p>
              <p className="text-[0.5rem] font-bold text-[var(--text-muted)] uppercase">{cfg.label}</p>
            </button>
          )
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-3">
        {(['all', 'churned', 'at-risk'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${filter === f ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            {f === 'all' ? 'All' : f === 'at-risk' ? 'At Risk' : 'Churned'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No {filter === 'all' ? '' : filter + ' '}customers</p>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {filtered.slice(0, 20).map(c => {
            const cfg = statusCfg[c.status]
            return (
              <div key={c.email} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                  <p className="text-[0.625rem] text-[var(--text-muted)]">{c.orderCount} orders · ${c.totalSpend.toLocaleString()}</p>
                </div>
                <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${cfg.bg} ${cfg.color}`}>{c.daysSince}d ago</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
