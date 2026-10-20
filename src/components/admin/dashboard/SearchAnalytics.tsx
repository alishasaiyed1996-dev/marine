import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { orderItemLineTotal, orderItemSku, relationName } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function SearchAnalytics({ products, orders }: Props) {
  const [view, setView] = useState<'top-products' | 'by-category' | 'by-brand'>('top-products')

  const analytics = useMemo(() => {
    // Product view/popularity based on order frequency
    const productPopularity: Record<string, {
      name: string; sku: string; brand: string; category: string;
      orderCount: number; totalSold: number; revenue: number;
    }> = {}

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      for (const item of order.items || []) {
        const pid = item.productId || orderItemSku(item) || item.productName || 'unknown'
        if (!productPopularity[pid]) {
          const product = products.find((p: any) => p.id === pid || (p.sku && p.sku === pid))
          productPopularity[pid] = {
            name: item.productName || item.name || product?.name || 'Unknown',
            sku: orderItemSku(item) || product?.sku || pid,
            brand: relationName(product?.brand, '—'),
            category: relationName(product?.category, item.category || 'Uncategorized'),
            orderCount: 0, totalSold: 0, revenue: 0,
          }
        }
        const data = productPopularity[pid]
        data.orderCount++
        data.totalSold += item.quantity || 1
        data.revenue += orderItemLineTotal(item)
      }
    }

    // Category aggregation
    const categoryData: Record<string, { orderCount: number; totalSold: number; revenue: number; productCount: number }> = {}
    for (const p of Object.values(productPopularity)) {
      const cat = p.category
      if (!categoryData[cat]) categoryData[cat] = { orderCount: 0, totalSold: 0, revenue: 0, productCount: 0 }
      categoryData[cat].orderCount += p.orderCount
      categoryData[cat].totalSold += p.totalSold
      categoryData[cat].revenue += p.revenue
      categoryData[cat].productCount++
    }

    // Brand aggregation
    const brandData: Record<string, { orderCount: number; totalSold: number; revenue: number; productCount: number }> = {}
    for (const p of Object.values(productPopularity)) {
      const brand = p.brand
      if (!brandData[brand]) brandData[brand] = { orderCount: 0, totalSold: 0, revenue: 0, productCount: 0 }
      brandData[brand].orderCount += p.orderCount
      brandData[brand].totalSold += p.totalSold
      brandData[brand].revenue += p.revenue
      brandData[brand].productCount++
    }

    const topProducts = Object.values(productPopularity).sort((a, b) => b.orderCount - a.orderCount)
    const topCategories = Object.entries(categoryData).sort((a, b) => b[1].revenue - a[1].revenue)
    const topBrands = Object.entries(brandData).sort((a, b) => b[1].revenue - a[1].revenue)

    const totalSearches = topProducts.reduce((s, p) => s + p.orderCount, 0)

    return { topProducts, topCategories, topBrands, totalSearches }
  }, [products, orders])

  const maxOrders = analytics.topProducts.length > 0 ? analytics.topProducts[0].orderCount : 1

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Search Analytics</h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">{analytics.totalSearches} interactions</span>
      </div>

      {/* View tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { key: 'top-products' as const, label: 'Top Products' },
          { key: 'by-category' as const, label: 'By Category' },
          { key: 'by-brand' as const, label: 'By Brand' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)}
            className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
              view === tab.key ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {view === 'top-products' && analytics.topProducts.slice(0, 15).map((p, idx) => (
          <div key={idx} className="rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-[0.5rem] font-bold text-[var(--text-muted)] w-4">#{idx + 1}</span>
                <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{p.name}</span>
              </div>
              <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${p.revenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-3 ml-6">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-soft)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--accent-blue)]" style={{ width: `${(p.orderCount / maxOrders) * 100}%` }} />
              </div>
              <span className="text-[0.5rem] text-[var(--text-muted)] shrink-0">{p.orderCount} orders · {p.totalSold} sold</span>
            </div>
          </div>
        ))}

        {view === 'by-category' && analytics.topCategories.map(([cat, data]) => (
          <div key={cat} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">{cat}</p>
              <p className="text-[0.625rem] text-[var(--text-muted)]">{data.productCount} products · {data.totalSold} sold</p>
            </div>
            <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${data.revenue.toLocaleString()}</span>
          </div>
        ))}

        {view === 'by-brand' && analytics.topBrands.map(([brand, data]) => (
          <div key={brand} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">{brand}</p>
              <p className="text-[0.625rem] text-[var(--text-muted)]">{data.productCount} products · {data.totalSold} sold</p>
            </div>
            <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${data.revenue.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
