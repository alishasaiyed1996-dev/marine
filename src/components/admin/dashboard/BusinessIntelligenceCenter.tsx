import { useMemo } from 'react'
import { Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ShoppingCart, Package, Users, DollarSign } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  stats: any
  orders: any[]
  rfqs: any[]
  products: any[]
  customers: any[]
}

interface Insight {
  category: string
  title: string
  value: string
  trend: 'up' | 'down' | 'stable'
  severity: 'positive' | 'warning' | 'critical' | 'neutral'
  icon: any
}

export function BusinessIntelligenceCenter({ orders, rfqs, products, customers }: Props) {
  const insights = useMemo<Insight[]>(() => {
    const now = Date.now()
    const DAY = 86400000
    const results: Insight[] = []

    // Revenue insights
    const completedOrders = orders.filter((o: any) => !isCancelledOrRefunded(o))
    const totalRevenue = completedOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const recentOrders = completedOrders.filter((o: any) => now - new Date(o.createdAt).getTime() < 30 * DAY)
    const recentRevenue = recentOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const prevOrders = completedOrders.filter((o: any) => {
      const t = new Date(o.createdAt).getTime()
      return t >= now - 60 * DAY && t < now - 30 * DAY
    })
    const prevRevenue = prevOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const revGrowth = prevRevenue > 0 ? ((recentRevenue - prevRevenue) / prevRevenue) * 100 : 0

    results.push({
      category: 'Revenue',
      title: '30-Day Revenue',
      value: `$${recentRevenue.toLocaleString()}`,
      trend: revGrowth > 0 ? 'up' : revGrowth < 0 ? 'down' : 'stable',
      severity: revGrowth > 10 ? 'positive' : revGrowth < -10 ? 'warning' : 'neutral',
      icon: DollarSign,
    })

    // Order health
    const cancelRate = orders.length > 0 ? (orders.filter((o: any) => o.status === 'cancelled').length / orders.length) * 100 : 0
    results.push({
      category: 'Operations',
      title: 'Cancellation Rate',
      value: `${cancelRate.toFixed(1)}%`,
      trend: cancelRate > 15 ? 'down' : 'stable',
      severity: cancelRate > 20 ? 'critical' : cancelRate > 15 ? 'warning' : 'positive',
      icon: ShoppingCart,
    })

    // Inventory health
    const lowStock = products.filter((p: any) => {
      const stock = p.stockCount || 0
      return stock > 0 && stock <= (p.lowStockThreshold ?? 10) && p.availability !== 'out-of-stock'
    }).length
    const outOfStock = products.filter((p: any) => (p.stockCount || 0) === 0 || p.availability === 'out-of-stock').length
    const stockHealthPct = products.length > 0 ? ((products.length - lowStock - outOfStock) / products.length) * 100 : 100

    results.push({
      category: 'Inventory',
      title: 'Stock Health',
      value: `${stockHealthPct.toFixed(0)}% healthy`,
      trend: stockHealthPct > 80 ? 'up' : 'down',
      severity: stockHealthPct > 80 ? 'positive' : stockHealthPct > 60 ? 'warning' : 'critical',
      icon: Package,
    })

    if (outOfStock > 0) {
      results.push({
        category: 'Inventory',
        title: 'Out of Stock Items',
        value: outOfStock.toString(),
        trend: 'down',
        severity: outOfStock > 10 ? 'critical' : 'warning',
        icon: AlertTriangle,
      })
    }

    // RFQ pipeline
    const newRfqs = rfqs.filter((r: any) => r.status === 'new').length
    const emergencyRfqs = rfqs.filter((r: any) => r.urgency === 'emergency' && r.status !== 'closed').length
    results.push({
      category: 'Sales',
      title: 'Pending RFQs',
      value: newRfqs.toString(),
      trend: 'stable',
      severity: emergencyRfqs > 0 ? 'critical' : newRfqs > 10 ? 'warning' : 'neutral',
      icon: AlertTriangle,
    })

    // Customer growth
    const recentCustomers = customers.filter((c: any) => {
      const created = new Date(c.createdAt || c.lastLoginAt || 0).getTime()
      return now - created < 30 * DAY
    }).length
    results.push({
      category: 'Customers',
      title: 'New Customers (30d)',
      value: recentCustomers.toString(),
      trend: recentCustomers > 0 ? 'up' : 'stable',
      severity: recentCustomers > 5 ? 'positive' : 'neutral',
      icon: Users,
    })

    // Average order value
    const aov = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0
    results.push({
      category: 'Revenue',
      title: 'Avg Order Value',
      value: `$${Math.round(aov).toLocaleString()}`,
      trend: 'stable',
      severity: aov > 500 ? 'positive' : 'neutral',
      icon: DollarSign,
    })

    // Top product performance
    const productSales: Record<string, number> = {}
    for (const order of completedOrders) {
      for (const item of order.items || []) {
        const pid = item.productId || item.productName
        if (pid) productSales[pid] = (productSales[pid] || 0) + (item.quantity || 1)
      }
    }
    const topSeller = Object.entries(productSales).sort((a, b) => b[1] - a[1])[0]
    if (topSeller) {
      const product = products.find((p: any) => p.id === topSeller[0])
      results.push({
        category: 'Products',
        title: 'Top Seller',
        value: `${product?.name || topSeller[0]} (${topSeller[1]} units)`,
        trend: 'up',
        severity: 'positive',
        icon: TrendingUp,
      })
    }

    // Slow sellers
    const productsWithNoSales = products.filter((p: any) => {
      const sold = productSales[p.id] || 0
      return sold === 0 && (p.stockCount || 0) > 0
    }).length
    if (productsWithNoSales > 0) {
      results.push({
        category: 'Products',
        title: 'Products with No Sales',
        value: productsWithNoSales.toString(),
        trend: 'down',
        severity: productsWithNoSales > 20 ? 'warning' : 'neutral',
        icon: TrendingDown,
      })
    }

    return results
  }, [orders, rfqs, products, customers])

  const positive = insights.filter(i => i.severity === 'positive').length
  const warnings = insights.filter(i => i.severity === 'warning').length
  const criticals = insights.filter(i => i.severity === 'critical').length

  const severityConfig = {
    positive: { color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: CheckCircle },
    warning: { color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: AlertTriangle },
    critical: { color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', icon: AlertTriangle },
    neutral: { color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: TrendingUp },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Business Intelligence Center</h2>
        </div>
        <div className="flex items-center gap-2">
          {criticals > 0 && <span className="rounded-lg bg-[var(--danger)]/10 px-2 py-0.5 text-[0.5rem] font-bold text-[var(--danger)]">{criticals} critical</span>}
          {warnings > 0 && <span className="rounded-lg bg-[var(--accent-gold)]/10 px-2 py-0.5 text-[0.5rem] font-bold text-[var(--accent-gold)]">{warnings} warnings</span>}
          <span className="rounded-lg bg-[var(--success)]/10 px-2 py-0.5 text-[0.5rem] font-bold text-[var(--success)]">{positive} healthy</span>
        </div>
      </div>

      {/* Insight cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {insights.map((insight, idx) => {
          const cfg = severityConfig[insight.severity]
          const Icon = insight.icon
          return (
            <div key={idx} className={`flex items-start gap-3 rounded-xl px-3 py-2.5 border ${insight.severity === 'critical' ? 'border-[var(--danger)]/20 bg-[var(--danger)]/5' : 'border-[var(--border)]'}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}>
                <Icon size={12} className={cfg.color} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">{insight.category}</p>
                <p className="text-xs font-semibold text-[var(--text-primary)]">{insight.title}</p>
                <p className="font-mono text-sm font-extrabold text-[var(--text-primary)]">{insight.value}</p>
              </div>
              {insight.trend !== 'stable' && (
                insight.trend === 'up' ? <TrendingUp size={12} className="text-[var(--success)] shrink-0 mt-1" /> :
                <TrendingDown size={12} className="text-[var(--danger)] shrink-0 mt-1" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
