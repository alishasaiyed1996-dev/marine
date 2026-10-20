import { useMemo, useState } from 'react'
import { Users, Filter } from 'lucide-react'
import { orderCustomerEmail, orderCustomerName } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

function scoreQuintile(values: number[], value: number): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.2)] ?? sorted[0]
  const q2 = sorted[Math.floor(sorted.length * 0.4)] ?? sorted[0]
  const q3 = sorted[Math.floor(sorted.length * 0.6)] ?? sorted[sorted.length - 1]
  const q4 = sorted[Math.floor(sorted.length * 0.8)] ?? sorted[sorted.length - 1]
  if (value <= q1) return 1
  if (value <= q2) return 2
  if (value <= q3) return 3
  if (value <= q4) return 4
  return 5
}

export function CustomerSegmentation({ orders }: Props) {
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null)

  const segments = useMemo(() => {
    const now = Date.now()
    const map = new Map<string, { name: string; spend: number; orderCount: number; lastOrder: string }>()
    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const email = orderCustomerEmail(order)
      if (!email) continue
      if (!map.has(email)) {
        map.set(email, { name: orderCustomerName(order), spend: 0, orderCount: 0, lastOrder: order.createdAt })
      }
      const c = map.get(email)!
      c.spend += order.total || 0
      c.orderCount++
      if (order.createdAt > c.lastOrder) c.lastOrder = order.createdAt
    }

    const customers = Array.from(map.entries()).map(([email, data]) => ({
      email, name: data.name, spend: data.spend, orderCount: data.orderCount,
      recency: Math.round((now - new Date(data.lastOrder).getTime()) / 86400000),
    }))

    const recencies = customers.map(c => c.recency)
    const frequencies = customers.map(c => c.orderCount)
    const monetarys = customers.map(c => c.spend)

    const scored = customers.map(c => ({
      ...c,
      r: scoreQuintile(recencies, c.recency),
      f: scoreQuintile(frequencies, c.orderCount),
      m: scoreQuintile(monetarys, c.spend),
    }))

    const segmentDefs: { name: string; color: string; bg: string; description: string; test: (c: typeof scored[0]) => boolean }[] = [
      { name: 'Champions', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', description: 'Best customers', test: c => c.r >= 4 && c.f >= 4 && c.m >= 4 },
      { name: 'Loyal', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', description: 'Frequent buyers', test: c => c.f >= 4 && c.m >= 3 },
      { name: 'Potential Loyalists', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', description: 'Could become loyal', test: c => c.r >= 3 && c.f >= 2 && c.f < 4 },
      { name: 'At Risk', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', description: 'Now inactive', test: c => c.r <= 2 && c.f >= 3 },
      { name: 'Hibernating', color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-soft)]', description: 'Low activity', test: c => c.r <= 2 && c.f <= 2 },
      { name: 'Lost', color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', description: 'No activity', test: c => c.r <= 1 && c.f <= 1 },
    ]

    return segmentDefs.map(def => ({
      name: def.name, color: def.color, bg: def.bg, description: def.description,
      customers: scored.filter(def.test).map(c => ({ email: c.email, name: c.name, spend: c.spend, orders: c.orderCount, rfm: `${c.r}-${c.f}-${c.m}` })).sort((a, b) => b.spend - a.spend),
    })).filter(s => s.customers.length > 0)
  }, [orders])

  const totalCustomers = segments.reduce((s, seg) => s + seg.customers.length, 0)
  const selected = segments.find(s => s.name === selectedSegment)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Customer Segmentation</h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">RFM · {totalCustomers} customers</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {segments.map(seg => (
          <button key={seg.name} onClick={() => setSelectedSegment(selectedSegment === seg.name ? null : seg.name)}
            className={`rounded-xl p-3 text-left transition-all ${selectedSegment === seg.name ? `${seg.bg} ring-2 ring-current/20` : 'bg-[var(--surface-soft)] hover:bg-[var(--border)]'}`}>
            <p className={`text-[0.625rem] font-bold uppercase ${seg.color}`}>{seg.name}</p>
            <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">{seg.customers.length}</p>
            <p className="text-[0.5rem] text-[var(--text-muted)] truncate">{seg.description}</p>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="border-t border-[var(--border)] pt-3">
          <h3 className={`text-xs font-bold mb-2 ${selected.color}`}>{selected.name} Customers</h3>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {selected.customers.slice(0, 15).map(c => (
              <div key={c.email} className="flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-[var(--surface-soft)]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                  <p className="text-[0.5rem] text-[var(--text-muted)]">{c.orders} orders · RFM {c.rfm}</p>
                </div>
                <span className="font-mono text-xs font-bold text-[var(--accent-gold)] ml-2">${c.spend.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <Filter size={16} className="mx-auto text-[var(--text-muted)] mb-1" />
          <p className="text-[0.625rem] text-[var(--text-muted)]">Click a segment to view customers</p>
        </div>
      )}
    </div>
  )
}
