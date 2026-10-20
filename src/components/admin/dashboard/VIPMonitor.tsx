import { useMemo, useState } from 'react'
import { Trophy, Medal, Star } from 'lucide-react'
import { orderCustomerEmail, orderCustomerName } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

export function VIPMonitor({ orders }: Props) {
  const [showAll, setShowAll] = useState(false)

  const customers = useMemo(() => {
    const map = new Map<string, { name: string; totalSpend: number; orderCount: number; lastOrder: string }>()
    for (const order of orders) {
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

    const now = Date.now()
    return Array.from(map.entries()).map(([email, data]) => {
      const daysSince = Math.round((now - new Date(data.lastOrder).getTime()) / 86400000)
      const tier = data.totalSpend >= 10000 ? 'gold' as const : data.totalSpend >= 5000 ? 'silver' as const : 'bronze' as const
      return { email, ...data, avgOrder: data.orderCount > 0 ? data.totalSpend / data.orderCount : 0, daysSince, tier }
    }).sort((a, b) => b.totalSpend - a.totalSpend)
  }, [orders])

  const displayed = showAll ? customers : customers.slice(0, 10)
  const tierConfig = {
    gold: { icon: Trophy, color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', label: 'Gold' },
    silver: { icon: Medal, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-soft)]', label: 'Silver' },
    bronze: { icon: Star, color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', label: 'Bronze' },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">VIP Customers</h2>
        </div>
        <div className="flex gap-1.5">
          <span className="rounded-md bg-[var(--accent-gold)]/10 px-1.5 py-0.5 text-[0.5rem] font-bold text-[var(--accent-gold)]">{customers.filter(c => c.tier === 'gold').length} Gold</span>
          <span className="rounded-md bg-[var(--surface-soft)] px-1.5 py-0.5 text-[0.5rem] font-bold text-[var(--text-muted)]">{customers.filter(c => c.tier === 'silver').length} Silver</span>
        </div>
      </div>

      {customers.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No customer data yet</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
            {displayed.map((c) => {
              const tier = tierConfig[c.tier]
              const Icon = tier.icon
              return (
                <div key={c.email} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tier.bg}`}><Icon size={14} className={tier.color} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                      <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${tier.bg} ${tier.color}`}>{tier.label}</span>
                    </div>
                    <p className="text-[0.625rem] text-[var(--text-muted)]">{c.orderCount} orders · avg ${Math.round(c.avgOrder)}/order</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-xs font-bold text-[var(--accent-gold)]">${c.totalSpend.toLocaleString()}</p>
                    <p className="text-[0.5rem] text-[var(--text-muted)]">{c.daysSince}d ago</p>
                  </div>
                </div>
              )
            })}
          </div>
          {customers.length > 10 && (
            <button onClick={() => setShowAll(!showAll)} className="mt-3 text-xs font-bold text-[var(--accent-gold)] hover:underline">
              {showAll ? 'Show less' : `View all ${customers.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
