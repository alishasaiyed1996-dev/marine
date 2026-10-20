import { useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import { orderItemLineTotal, orderItemSku } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function BestsellerInsights({ products, orders }: Props) {
  const [metric, setMetric] = useState<'revenue' | 'quantity'>('revenue')

  const bestsellers = useMemo(() => {
    const map = new Map<string, { name: string; sku: string; brand: string; revenue: number; quantity: number; image: string }>()

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      for (const item of order.items || []) {
        const key = item.productId || orderItemSku(item) || item.productName
        if (!key) continue
        if (!map.has(key)) {
          map.set(key, {
            name: item.productName || item.name || 'Product',
            sku: orderItemSku(item),
            brand: '',
            revenue: 0,
            quantity: 0,
            image: '',
          })
        }
        const entry = map.get(key)!
        entry.revenue += orderItemLineTotal(item)
        entry.quantity += item.quantity || 1
      }
    }

    // Enrich with product data (match either id or SKU).
    const productMap = new Map<string, any>()
    for (const product of products) {
      productMap.set(product.id, product)
      if (product.sku) productMap.set(product.sku, product)
    }
    for (const [key, entry] of map) {
      const product = productMap.get(key)
      if (product) {
        entry.brand = product.brand?.name || product.brand || ''
        entry.image = product.images?.[0]?.url || ''
      }
    }

    const sorted = Array.from(map.values())
    if (metric === 'revenue') sorted.sort((a, b) => b.revenue - a.revenue)
    else sorted.sort((a, b) => b.quantity - a.quantity)

    const maxValue = sorted.length > 0 ? (metric === 'revenue' ? sorted[0].revenue : sorted[0].quantity) : 1

    return { items: sorted.slice(0, 15), maxValue, totalRevenue: sorted.reduce((s, p) => s + p.revenue, 0), totalSold: sorted.reduce((s, p) => s + p.quantity, 0) }
  }, [products, orders, metric])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Bestseller Insights
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {bestsellers.items.length} products
        </span>
      </div>

      {/* Metric toggle */}
      <div className="flex gap-1.5 mb-4">
        {(['revenue', 'quantity'] as const).map(m => (
          <button key={m} onClick={() => setMetric(m)}
            className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
              metric === m ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}>
            {m === 'revenue' ? 'By Revenue' : 'By Quantity'}
          </button>
        ))}
      </div>

      {bestsellers.items.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No sales data yet</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {bestsellers.items.map((p, i) => {
              const value = metric === 'revenue' ? p.revenue : p.quantity
              const width = bestsellers.maxValue > 0 ? (value / bestsellers.maxValue) * 100 : 0
              return (
                <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                  <span className="font-mono text-[0.5rem] text-[var(--text-muted)] w-4 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{p.name}</p>
                    <p className="text-[0.625rem] text-[var(--text-muted)]">{p.sku} {p.brand ? `· ${p.brand}` : ''}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-[var(--surface-soft)] overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-gold)] to-[var(--accent-teal)]"
                        style={{ width: `${width}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    {metric === 'revenue' ? (
                      <p className="font-mono text-xs font-bold text-[var(--accent-gold)]">${p.revenue.toLocaleString()}</p>
                    ) : (
                      <p className="font-mono text-xs font-bold text-[var(--accent-teal)]">{p.quantity}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)] text-xs">
            <span className="text-[var(--text-muted)]">Total Revenue: <span className="font-mono font-bold text-[var(--text-primary)]">${bestsellers.totalRevenue.toLocaleString()}</span></span>
            <span className="text-[var(--text-muted)]">Total Sold: <span className="font-mono font-bold text-[var(--text-primary)]">{bestsellers.totalSold}</span></span>
          </div>
        </>
      )}
    </div>
  )
}
