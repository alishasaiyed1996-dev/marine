import { useMemo } from 'react'
import { Crown, TrendingUp, ShoppingCart, FileText, AlertTriangle, Package, DollarSign } from 'lucide-react'
import { orderItemLineTotal, orderItemSku, relationName } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  stats: any
  orders: any[]
  rfqs: any[]
  alerts: any[]
  products: any[]
}

export function ExecutiveDashboard({ stats, orders, rfqs, alerts, products }: Props) {
  const data = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000

    // Cancelled/refunded orders are not realized revenue and must not inflate
    // period counts or the average-order-value denominator.
    const validOrders = orders.filter((o: any) => !isCancelledOrRefunded(o))
    const activeOrders = validOrders.filter(o => o.status !== 'delivered')
    const todayOrders = validOrders.filter(o => o.createdAt?.startsWith(new Date().toISOString().split('T')[0]))
    const thisWeekOrders = validOrders.filter(o => (now - new Date(o.createdAt).getTime()) < 7 * DAY)
    const thisMonthOrders = validOrders.filter(o => (now - new Date(o.createdAt).getTime()) < 30 * DAY)

    const totalRevenue = validOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const monthRevenue = thisMonthOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const weekRevenue = thisWeekOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const todayRevenue = todayOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)

    const pendingRfqs = rfqs.filter(r => r.status !== 'won' && r.status !== 'lost' && r.status !== 'closed')
    const emergencyRfqs = rfqs.filter(r => r.urgency === 'emergency' && r.status !== 'closed')
    const dangerAlerts = alerts.filter((a: any) => a.type === 'danger')

    const lowStockProducts = products.filter((p: any) => {
      const stock = p.stockCount || 0
      return stock > 0 && stock <= (p.lowStockThreshold ?? 10) && p.availability !== 'out-of-stock'
    })
    const outOfStock = products.filter((p: any) => p.availability === 'out-of-stock' || (p.stockCount || 0) <= 0)

    // Revenue per product category. Order items only carry productId/SKU, so
    // resolve the product (and its category relation) from the catalogue.
    const productMap = new Map<string, any>()
    for (const product of products) {
      productMap.set(product.id, product)
      if (product.sku) productMap.set(product.sku, product)
    }

    const categoryRevenue: Record<string, number> = {}
    for (const order of validOrders) {
      for (const item of order.items || []) {
        const product = productMap.get(item.productId) || productMap.get(orderItemSku(item))
        const cat = relationName(product?.category, 'Uncategorized')
        categoryRevenue[cat] = (categoryRevenue[cat] || 0) + orderItemLineTotal(item)
      }
    }
    const topCategory = Object.entries(categoryRevenue).sort((a, b) => b[1] - a[1])[0]

    return {
      totalRevenue, monthRevenue, weekRevenue, todayRevenue,
      activeOrders: activeOrders.length, totalOrders: validOrders.length,
      todayOrderCount: todayOrders.length,
      weekOrderCount: thisWeekOrders.length,
      monthOrderCount: thisMonthOrders.length,
      pendingRfqs: pendingRfqs.length, emergencyRfqs: emergencyRfqs.length,
      alertCount: dangerAlerts.length + emergencyRfqs.length,
      // `stats` counts the full catalog; `products` is capped for dashboard use.
      lowStockCount: stats?.lowStockCount ?? lowStockProducts.length,
      outOfStockCount: stats?.outOfStockProducts ?? outOfStock.length,
      topCategory: topCategory ? { name: topCategory[0], revenue: topCategory[1] } : null,
      avgOrderValue: validOrders.length > 0 ? totalRevenue / validOrders.length : 0,
    }
  }, [stats, orders, rfqs, alerts, products])

  const bigStats = [
    { label: 'Total Revenue', value: `$${data.totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10' },
    { label: 'Active Orders', value: data.activeOrders.toString(), icon: ShoppingCart, color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10' },
    { label: 'Pending RFQs', value: data.pendingRfqs.toString(), icon: FileText, color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10' },
    { label: 'Low Stock Items', value: data.lowStockCount.toString(), icon: Package, color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10' },
    { label: 'Urgent Alerts', value: data.alertCount.toString(), icon: AlertTriangle, color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10' },
    { label: 'Avg Order Value', value: `$${Math.round(data.avgOrderValue).toLocaleString()}`, icon: TrendingUp, color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10' },
  ]

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 mb-5">
        <Crown size={18} className="text-[var(--accent-gold)]" />
        <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Executive Dashboard</h2>
      </div>

      {/* Big stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        {bigStats.map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} className="rounded-xl bg-[var(--surface-soft)] p-4 text-center">
              <div className={`mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${s.bg}`}>
                <Icon size={16} className={s.color} />
              </div>
              <p className="font-display text-xl font-extrabold text-[var(--text-primary)]">{s.value}</p>
              <p className="text-[0.625rem] text-[var(--text-muted)] font-bold uppercase mt-0.5">{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Period breakdown */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Today', revenue: data.todayRevenue, orders: data.todayOrderCount },
          { label: 'This Week', revenue: data.weekRevenue, orders: data.weekOrderCount },
          { label: 'This Month', revenue: data.monthRevenue, orders: data.monthOrderCount },
        ].map(p => (
          <div key={p.label} className="rounded-xl border border-[var(--border)] p-3 text-center">
            <p className="text-[0.5rem] font-bold text-[var(--text-muted)] uppercase">{p.label}</p>
            <p className="font-mono text-sm font-extrabold text-[var(--text-primary)] mt-1">${p.revenue.toLocaleString()}</p>
            <p className="text-[0.5rem] text-[var(--text-muted)]">{p.orders} orders</p>
          </div>
        ))}
      </div>

      {/* Top category */}
      {data.topCategory && (
        <div className="rounded-xl bg-[var(--surface-soft)] px-3 py-2 flex items-center justify-between">
          <span className="text-[0.625rem] text-[var(--text-muted)]">Top Category</span>
          <span className="text-xs font-bold text-[var(--text-primary)]">{data.topCategory.name} — ${data.topCategory.revenue.toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}
