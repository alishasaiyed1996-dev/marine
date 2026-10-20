import { useMemo, useState } from 'react'
import { Globe, TrendingUp, ShoppingCart, Users } from 'lucide-react'
import { orderCustomerEmail, orderCustomerName } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  orders: any[]
}

const FLAGS: Record<string, string> = {
  'US': '🇺🇸', 'GB': '🇬🇧', 'AE': '🇦🇪', 'SA': '🇸🇦', 'IN': '🇮🇳', 'DE': '🇩🇪',
  'SG': '🇸🇬', 'NL': '🇳🇱', 'JP': '🇯🇵', 'KR': '🇰🇷', 'CN': '🇨🇳', 'TR': '🇹🇷',
  'PH': '🇵🇭', 'ID': '🇮🇩', 'MY': '🇲🇾', 'TH': '🇹🇭', 'VN': '🇻🇳', 'NG': '🇳🇬',
  'ZA': '🇿🇦', 'BR': '🇧🇷', 'MX': '🇲🇽', 'AU': '🇦🇺', 'CA': '🇨🇦', 'FR': '🇫🇷',
  'IT': '🇮🇹', 'ES': '🇪🇸',  'PK': '🇵🇰', 'BD': '🇧🇩', 'EG': '🇪🇬', 'QA': '🇶🇦',
  'KW': '🇰🇼', 'OM': '🇴🇲', 'BH': '🇧🇭', 'JO': '🇯🇴',  'IQ': '🇮🇶',
  'NZ': '🇳🇿', 'SE': '🇸🇪', 'NO': '🇳🇴', 'DK': '🇩🇰',
  'PL': '🇵🇱', 'CZ': '🇨🇿', 'AT': '🇦🇹', 'CH': '🇨🇭',
}

export function GeoSalesAnalytics({ orders }: Props) {
  const [sortBy, setSortBy] = useState<'revenue' | 'orders' | 'customers'>('revenue')

  const geoData = useMemo(() => {
    const countryMap: Record<string, {
      revenue: number; orderCount: number; customers: Set<string>;
      avgOrder: number; topProducts: Record<string, number>;
    }> = {}

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      const country = order.shippingCountry || order.country || order.customerCountry || 'Unknown'
      if (!countryMap[country]) {
        countryMap[country] = { revenue: 0, orderCount: 0, customers: new Set(), avgOrder: 0, topProducts: {} }
      }
      const data = countryMap[country]
      data.revenue += order.total || 0
      data.orderCount++
      data.customers.add(orderCustomerEmail(order) || orderCustomerName(order) || '')

      for (const item of order.items || []) {
        const name = item.productName || item.name || 'Product'
        data.topProducts[name] = (data.topProducts[name] || 0) + (item.quantity || 1)
      }
    }

    const totalRevenue = Object.values(countryMap).reduce((s, d) => s + d.revenue, 0)

    return Object.entries(countryMap)
      .map(([country, data]) => ({
        country,
        flag: FLAGS[country] || '🌍',
        revenue: data.revenue,
        orderCount: data.orderCount,
        customerCount: data.customers.size,
        avgOrder: data.orderCount > 0 ? data.revenue / data.orderCount : 0,
        pctOfTotal: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
        topProduct: Object.entries(data.topProducts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
      }))
      .sort((a, b) => {
        if (sortBy === 'revenue') return b.revenue - a.revenue
        if (sortBy === 'orders') return b.orderCount - a.orderCount
        return b.customerCount - a.customerCount
      })
  }, [orders, sortBy])

  const maxRevenue = geoData.length > 0 ? Math.max(...geoData.map((d) => d.revenue), 1) : 1

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Geo Sales Analytics</h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">{geoData.length} countries</span>
      </div>

      {/* Sort tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { key: 'revenue' as const, label: 'Revenue', icon: TrendingUp },
          { key: 'orders' as const, label: 'Orders', icon: ShoppingCart },
          { key: 'customers' as const, label: 'Customers', icon: Users },
        ].map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.key} onClick={() => setSortBy(tab.key)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
                sortBy === tab.key ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}>
              <Icon size={10} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* Country list with bars */}
      {geoData.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No geographic data available</p>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {geoData.slice(0, 15).map((g, idx) => (
            <div key={g.country} className="rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{g.flag}</span>
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{g.country}</span>
                  <span className="text-[0.5rem] text-[var(--text-muted)]">#{idx + 1}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">${g.revenue.toLocaleString()}</span>
                  <span className="text-[0.5rem] text-[var(--text-muted)]">{g.pctOfTotal.toFixed(1)}%</span>
                </div>
              </div>
              {/* Bar */}
              <div className="h-1.5 rounded-full bg-[var(--surface-soft)] overflow-hidden mb-1">
                <div className="h-full rounded-full bg-[var(--accent-teal)] transition-all"
                  style={{ width: `${(g.revenue / maxRevenue) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between text-[0.5rem] text-[var(--text-muted)]">
                <span>{g.orderCount} orders · {g.customerCount} customers</span>
                <span>Avg ${Math.round(g.avgOrder).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
