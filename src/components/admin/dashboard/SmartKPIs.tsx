import { useMemo } from 'react'
import { Package, CheckCircle, DollarSign, AlertTriangle, Sparkles, Tag, FileText, BarChart3 } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface KPI {
  label: string
  value: string
  icon: typeof Package
  color: string
  bg: string
  subtitle?: string
}

interface Props {
  stats: any
  orders: any[]
  rfqs: any[]
  products: any[]
}

export function SmartKPIs({ stats, orders, rfqs, products }: Props) {
  const kpis: KPI[] = useMemo(() => {
    const total = stats?.totalProducts || 0
    const inStockRate = total > 0 ? Math.round(((stats?.inStockProducts || 0) / total) * 100) : 0

    const stockValue = products.reduce(
      (sum, p) => sum + (p.regularPrice || 0) * (p.stockCount || 0), 0
    )

    const validOrders = orders.filter(o => !isCancelledOrRefunded(o))
    const avgOrder = validOrders.length > 0
      ? validOrders.reduce((sum, o) => sum + (o.total || 0), 0) / validOrders.length
      : 0

    const pendingRfqs = rfqs.filter(r => r.status === 'new').length

    return [
      {
        label: 'Total Products',
        value: String(total),
        icon: Package,
        color: 'text-[var(--accent-blue)]',
        bg: 'bg-[var(--accent-blue)]/10',
      },
      {
        label: 'In-Stock Rate',
        value: `${inStockRate}%`,
        icon: CheckCircle,
        color: 'text-[var(--success)]',
        bg: 'bg-[var(--success)]/10',
        subtitle: `${stats?.inStockProducts || 0} of ${total}`,
      },
      {
        label: 'Stock Value',
        value: `$${stockValue.toLocaleString()}`,
        icon: DollarSign,
        color: 'text-[var(--accent-gold)]',
        bg: 'bg-[var(--accent-gold)]/10',
      },
      {
        label: 'Emergency Items',
        value: String(stats?.emergencyProducts || 0),
        icon: AlertTriangle,
        color: 'text-[var(--danger)]',
        bg: 'bg-[var(--danger)]/10',
      },
      {
        label: 'New Arrivals',
        value: String(stats?.newArrivals || 0),
        icon: Sparkles,
        color: 'text-[var(--accent-teal)]',
        bg: 'bg-[var(--accent-teal)]/10',
      },
      {
        label: 'On Sale',
        value: String(stats?.saleProducts || 0),
        icon: Tag,
        color: 'text-[var(--accent-gold)]',
        bg: 'bg-[var(--accent-gold)]/10',
      },
      {
        label: 'Open RFQs',
        value: String(pendingRfqs),
        icon: FileText,
        color: 'text-[var(--accent-blue)]',
        bg: 'bg-[var(--accent-blue)]/10',
      },
      {
        label: 'Avg Order Value',
        value: `$${Math.round(avgOrder).toLocaleString()}`,
        icon: BarChart3,
        color: 'text-[var(--accent-teal)]',
        bg: 'bg-[var(--accent-teal)]/10',
      },
    ]
  }, [stats, orders, rfqs, products])

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {kpis.map(kpi => {
        const Icon = kpi.icon
        return (
          <div key={kpi.label} className="admin-stat-card">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {kpi.label}
                </p>
                <p className="mt-1.5 font-display text-xl font-extrabold text-[var(--text-primary)] truncate">
                  {kpi.value}
                </p>
                {kpi.subtitle && (
                  <p className="mt-0.5 text-[0.5rem] text-[var(--text-muted)] font-medium">
                    {kpi.subtitle}
                  </p>
                )}
              </div>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${kpi.bg} ${kpi.color}`}>
                <Icon size={16} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
