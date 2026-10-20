import { useMemo, useState } from 'react'
import { Crown } from 'lucide-react'
import { orderCustomerEmail, orderCustomerName } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

interface CustomerData {
  email: string
  name: string
  totalSpend: number
  orderCount: number
  avgOrderValue: number
  firstOrder: string
  lastOrder: string
  daysSinceLastOrder: number
}

export function CustomerLifetimeValue({ orders }: Props) {
  const [showAll, setShowAll] = useState(false)

  const customers = useMemo(() => {
    const map = new Map<string, CustomerData>()

    for (const order of orders) {
      // Cancelled/refunded orders are not realized customer spend and would
      // otherwise inflate lifetime value and recency.
      if (isCancelledOrRefunded(order)) continue
      const email = orderCustomerEmail(order)
      if (!email) continue
      if (!map.has(email)) {
        map.set(email, {
          email,
          name: orderCustomerName(order),
          totalSpend: 0,
          orderCount: 0,
          avgOrderValue: 0,
          firstOrder: order.createdAt,
          lastOrder: order.createdAt,
          daysSinceLastOrder: 0,
        })
      }
      const c = map.get(email)!
      c.totalSpend += order.total || 0
      c.orderCount++
      if (order.createdAt < c.firstOrder) c.firstOrder = order.createdAt
      if (order.createdAt > c.lastOrder) c.lastOrder = order.createdAt
    }

    const now = Date.now()
    return Array.from(map.values()).map(c => ({
      ...c,
      avgOrderValue: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
      daysSinceLastOrder: Math.round((now - new Date(c.lastOrder).getTime()) / 86400000),
    })).sort((a, b) => b.totalSpend - a.totalSpend)
  }, [orders])

  const displayed = showAll ? customers : customers.slice(0, 10)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Crown size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Customer Lifetime Value
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {customers.length} customers
        </span>
      </div>

      {customers.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No customer data yet</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
            {displayed.map((c, i) => (
              <div key={c.email} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono text-[0.5rem] text-[var(--text-muted)] w-4">{i + 1}.</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                    <p className="text-[0.625rem] text-[var(--text-muted)]">
                      {c.orderCount} orders · {c.daysSinceLastOrder}d ago
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="font-mono text-xs font-bold text-[var(--accent-gold)]">
                    ${c.totalSpend.toLocaleString()}
                  </p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">
                    avg ${Math.round(c.avgOrderValue)}/order
                  </p>
                </div>
              </div>
            ))}
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
