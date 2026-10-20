import { useMemo } from 'react'
import { TowerControl, Target, DollarSign, ShoppingCart, Package } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'
import { orderCustomerEmail } from './orderFields'

interface Props {
  stats: any
  orders: any[]
  rfqs: any[]
  products: any[]
  customers: any[]
  alerts: any[]
}

export function ExecutiveControlTower({ orders, rfqs, products, alerts }: Props) {
  const data = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000
    const completed = orders.filter((o: any) => !isCancelledOrRefunded(o))
    const cancelled = orders.filter((o: any) => o.status === 'cancelled')

    // Revenue
    const totalRevenue = completed.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const monthRevenue = completed.filter((o: any) => now - new Date(o.createdAt).getTime() < 30 * DAY)
      .reduce((s: number, o: any) => s + (o.total || 0), 0)
    const prevMonthRevenue = completed.filter((o: any) => {
      const t = new Date(o.createdAt).getTime()
      return t >= now - 60 * DAY && t < now - 30 * DAY
    }).reduce((s: number, o: any) => s + (o.total || 0), 0)
    const revGrowth = prevMonthRevenue > 0 ? ((monthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100 : 0

    // Orders
    const totalOrders = orders.length
    const activeOrders = orders.filter((o: any) => !['cancelled', 'delivered'].includes(o.status)).length
    const cancelRate = totalOrders > 0 ? (cancelled.length / totalOrders) * 100 : 0

    // AOV
    const aov = completed.length > 0 ? totalRevenue / completed.length : 0

    // Inventory
    const lowStock = products.filter((p: any) => {
      const stock = p.stockCount || 0
      return stock > 0 && stock <= (p.lowStockThreshold ?? 10) && p.availability !== 'out-of-stock'
    }).length
    const outOfStock = products.filter((p: any) => (p.stockCount || 0) === 0 || p.availability === 'out-of-stock').length

    // RFQs
    const pendingRfqs = rfqs.filter((r: any) => r.status !== 'won' && r.status !== 'lost' && r.status !== 'closed').length
    const emergencyRfqs = rfqs.filter((r: any) => r.urgency === 'emergency' && r.status !== 'closed').length

    // Fraud risk
    const emailOrders: Record<string, number> = {}
    for (const o of orders) {
      const email = orderCustomerEmail(o)
      if (email) emailOrders[email] = (emailOrders[email] || 0) + 1
    }
    const rapidOrderers = Object.entries(emailOrders).filter(([, count]) => count >= 5).length

    // Customer count
    const uniqueCustomers = new Set(orders.map((o: any) => orderCustomerEmail(o)).filter(Boolean)).size

    return {
      totalRevenue, monthRevenue, revGrowth, totalOrders, activeOrders,
      cancelRate, aov, lowStock, outOfStock, pendingRfqs, emergencyRfqs,
      rapidOrderers, uniqueCustomers,
      dangerAlerts: alerts.filter((a: any) => a.type === 'danger').length,
    }
  }, [orders, rfqs, products, alerts])

  const sections = [
    {
      title: 'Revenue', icon: DollarSign, color: 'text-[var(--accent-gold)]',
      metrics: [
        { label: 'Total Revenue', value: `$${data.totalRevenue.toLocaleString()}` },
        { label: 'This Month', value: `$${data.monthRevenue.toLocaleString()}` },
        { label: 'Growth', value: `${data.revGrowth >= 0 ? '+' : ''}${data.revGrowth.toFixed(1)}%`, color: data.revGrowth >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]' },
        { label: 'Avg Order', value: `$${Math.round(data.aov).toLocaleString()}` },
      ],
    },
    {
      title: 'Orders', icon: ShoppingCart, color: 'text-[var(--accent-blue)]',
      metrics: [
        { label: 'Total', value: data.totalOrders.toString() },
        { label: 'Active', value: data.activeOrders.toString() },
        { label: 'Cancel Rate', value: `${data.cancelRate.toFixed(1)}%`, color: data.cancelRate > 15 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]' },
        { label: 'Customers', value: data.uniqueCustomers.toString() },
      ],
    },
    {
      title: 'Inventory', icon: Package, color: 'text-[var(--accent-teal)]',
      metrics: [
        { label: 'Total Products', value: products.length.toString() },
        { label: 'Low Stock', value: data.lowStock.toString(), color: data.lowStock > 10 ? 'text-[var(--accent-gold)]' : 'text-[var(--text-primary)]' },
        { label: 'Out of Stock', value: data.outOfStock.toString(), color: data.outOfStock > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]' },
        { label: 'Stock Health', value: `${products.length > 0 ? Math.round(((products.length - data.lowStock - data.outOfStock) / products.length) * 100) : 100}%` },
      ],
    },
    {
      title: 'Sales Pipeline', icon: Target, color: 'text-[var(--accent-gold)]',
      metrics: [
        { label: 'Pending RFQs', value: data.pendingRfqs.toString() },
        { label: 'Emergency', value: data.emergencyRfqs.toString(), color: data.emergencyRfqs > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]' },
        { label: 'Alerts', value: data.dangerAlerts.toString(), color: data.dangerAlerts > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]' },
        { label: 'Rapid Buyers', value: data.rapidOrderers.toString(), color: data.rapidOrderers > 0 ? 'text-[var(--accent-gold)]' : 'text-[var(--text-primary)]' },
      ],
    },
  ]

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <TowerControl size={16} className="text-[var(--accent-gold)]" />
        <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Executive Control Tower</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {sections.map(section => {
          const Icon = section.icon
          return (
            <div key={section.title} className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <Icon size={12} className={section.color} />
                <h3 className="text-[0.625rem] font-bold text-[var(--text-secondary)]">{section.title}</h3>
              </div>
              <div className="space-y-2">
                {section.metrics.map(m => (
                  <div key={m.label} className="flex items-center justify-between">
                    <span className="text-[0.5rem] text-[var(--text-muted)]">{m.label}</span>
                    <span className={`font-mono text-[0.625rem] font-bold ${m.color || 'text-[var(--text-primary)]'}`}>{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
