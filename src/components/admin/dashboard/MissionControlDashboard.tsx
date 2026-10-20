import { useMemo, useState } from 'react'
import { Rocket, Shield, DollarSign, Package, Users, ShoppingCart, TrendingUp, Globe, Target, Zap, AlertTriangle } from 'lucide-react'
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

type Section = 'all' | 'revenue' | 'operations' | 'inventory' | 'customers' | 'security'

export function MissionControlDashboard({ orders, rfqs, products, customers, alerts }: Props) {
  const [section, setSection] = useState<Section>('all')

  const data = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000
    const completed = orders.filter((o: any) => !isCancelledOrRefunded(o))
    const cancelled = orders.filter((o: any) => o.status === 'cancelled')

    const totalRevenue = completed.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const monthOrders = completed.filter((o: any) => now - new Date(o.createdAt).getTime() < 30 * DAY)
    const monthRevenue = monthOrders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const aov = completed.length > 0 ? totalRevenue / completed.length : 0
    const cancelRate = orders.length > 0 ? (cancelled.length / orders.length) * 100 : 0

    const lowStock = products.filter((p: any) => {
      const stock = p.stockCount || 0
      return stock > 0 && stock <= (p.lowStockThreshold ?? 10) && p.availability !== 'out-of-stock'
    }).length
    const outOfStock = products.filter((p: any) => (p.stockCount || 0) === 0 || p.availability === 'out-of-stock').length
    const stockValue = products.reduce((s: number, p: any) => s + (Number(p.regularPrice) || 0) * (p.stockCount || 0), 0)

    const pendingRfqs = rfqs.filter((r: any) => r.status === 'new').length
    const emergencyRfqs = rfqs.filter((r: any) => r.urgency === 'emergency' && r.status !== 'closed').length

    const uniqueCustomers = new Set(orders.map((o: any) => orderCustomerEmail(o)).filter(Boolean)).size
    const dangerAlerts = alerts.filter((a: any) => a.type === 'danger').length

    // Countries
    const countries = new Set(orders.map((o: any) => o.shippingCountry || o.country).filter(Boolean)).size

    return {
      totalRevenue, monthRevenue, aov, cancelRate,
      totalProducts: products.length, lowStock, outOfStock, stockValue,
      totalOrders: orders.length, activeOrders: orders.filter((o: any) => !['cancelled', 'delivered'].includes(o.status)).length,
      pendingRfqs, emergencyRfqs,
      uniqueCustomers, dangerAlerts, countries,
    }
  }, [orders, rfqs, products, alerts])

  const sections: Array<{ key: Section; label: string; icon: any; color: string; metrics: Array<{ label: string; value: string; color?: string; icon: any }> }> = [
    {
      key: 'revenue', label: 'Revenue & Sales', icon: DollarSign, color: 'text-[var(--accent-gold)]',
      metrics: [
        { label: 'Total Revenue', value: `$${data.totalRevenue.toLocaleString()}`, icon: DollarSign },
        { label: 'Monthly Revenue', value: `$${data.monthRevenue.toLocaleString()}`, icon: TrendingUp },
        { label: 'Avg Order Value', value: `$${Math.round(data.aov).toLocaleString()}`, icon: ShoppingCart },
        { label: 'Cancel Rate', value: `${data.cancelRate.toFixed(1)}%`, color: data.cancelRate > 15 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]', icon: AlertTriangle },
      ],
    },
    {
      key: 'operations', label: 'Orders & Pipeline', icon: ShoppingCart, color: 'text-[var(--accent-blue)]',
      metrics: [
        { label: 'Total Orders', value: data.totalOrders.toString(), icon: ShoppingCart },
        { label: 'Active Orders', value: data.activeOrders.toString(), icon: Zap },
        { label: 'Pending RFQs', value: data.pendingRfqs.toString(), icon: Target },
        { label: 'Emergency RFQs', value: data.emergencyRfqs.toString(), color: data.emergencyRfqs > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]', icon: AlertTriangle },
      ],
    },
    {
      key: 'inventory', label: 'Inventory', icon: Package, color: 'text-[var(--accent-teal)]',
      metrics: [
        { label: 'Total Products', value: data.totalProducts.toString(), icon: Package },
        { label: 'Stock Value', value: `$${data.stockValue.toLocaleString()}`, icon: DollarSign },
        { label: 'Low Stock', value: data.lowStock.toString(), color: data.lowStock > 10 ? 'text-[var(--accent-gold)]' : 'text-[var(--text-primary)]', icon: AlertTriangle },
        { label: 'Out of Stock', value: data.outOfStock.toString(), color: data.outOfStock > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]', icon: AlertTriangle },
      ],
    },
    {
      key: 'customers', label: 'Customers & Reach', icon: Users, color: 'text-[var(--accent-blue)]',
      metrics: [
        { label: 'Unique Customers', value: data.uniqueCustomers.toString(), icon: Users },
        { label: 'Countries Served', value: data.countries.toString(), icon: Globe },
        { label: 'Customer Growth', value: `${customers.length} total`, icon: TrendingUp },
        { label: 'RFQ Pipeline', value: `${data.pendingRfqs} pending`, icon: Target },
      ],
    },
    {
      key: 'security', label: 'Security & Alerts', icon: Shield, color: 'text-[var(--danger)]',
      metrics: [
        { label: 'Danger Alerts', value: data.dangerAlerts.toString(), color: data.dangerAlerts > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]', icon: AlertTriangle },
        { label: 'Emergency RFQs', value: data.emergencyRfqs.toString(), color: data.emergencyRfqs > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]', icon: AlertTriangle },
        { label: 'Cancel Rate', value: `${data.cancelRate.toFixed(1)}%`, color: data.cancelRate > 15 ? 'text-[var(--danger)]' : 'text-[var(--success)]', icon: AlertTriangle },
        { label: 'System Status', value: 'Operational', color: 'text-[var(--success)]', icon: Shield },
      ],
    },
  ]

  const visibleSections = section === 'all' ? sections : sections.filter(s => s.key === section)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Rocket size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Mission Control Dashboard</h2>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(['all', 'revenue', 'operations', 'inventory', 'customers', 'security'] as const).map(s => (
            <button key={s} onClick={() => setSection(s)}
              className={`shrink-0 rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${
                section === s ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'
              }`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {visibleSections.map(sec => {
          const Icon = sec.icon
          return (
            <div key={sec.key} className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center gap-1.5 mb-3">
                <Icon size={12} className={sec.color} />
                <h3 className="text-[0.625rem] font-bold text-[var(--text-secondary)]">{sec.label}</h3>
              </div>
              <div className="space-y-2">
                {sec.metrics.map(m => {
                  const MetricIcon = m.icon
                  return (
                    <div key={m.label} className="flex items-center gap-2">
                      <MetricIcon size={8} className="text-[var(--text-muted)] shrink-0" />
                      <span className="text-[0.5rem] text-[var(--text-muted)] flex-1 truncate">{m.label}</span>
                      <span className={`font-mono text-[0.625rem] font-bold ${m.color || 'text-[var(--text-primary)]'}`}>{m.value}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
