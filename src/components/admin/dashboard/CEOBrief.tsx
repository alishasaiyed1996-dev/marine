import { useMemo } from 'react'
import { orderItemLineTotal } from '../../../lib/orderMetrics'
import { isCancelledOrRefunded } from './orderStatus'
import { ClipboardList, ShoppingCart, FileText, AlertTriangle, ArrowRight, Phone, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Props {
  orders: any[]
  rfqs: any[]
  alerts: any[]
}

export function CEOBrief({ orders, rfqs, alerts }: Props) {
  const brief = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const todayOrders = orders.filter(o => o.createdAt?.startsWith(today) && !isCancelledOrRefunded(o))
    const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0)
    // Open RFQs — 'in-progress' is not a real backend status; anything not
    // won/lost/closed is still being worked.
    const pendingRfqs = rfqs.filter(r => r.status !== 'won' && r.status !== 'lost' && r.status !== 'closed')
    const emergencyRfqs = rfqs.filter(r => r.urgency === 'emergency' && r.status !== 'closed')
    const dangerAlerts = alerts.filter(a => a.type === 'danger')

    // Top products by revenue across all orders
    const productRevenue: Record<string, { name: string; revenue: number; qty: number }> = {}
    for (const order of orders) {
      for (const item of order.items || []) {
        const key = item.productId || item.productName || 'Unknown'
        if (!productRevenue[key]) {
          productRevenue[key] = {
            name: item.productName || item.name || item.sku || 'Product',
            revenue: 0,
            qty: 0,
          }
        }
        productRevenue[key].revenue += orderItemLineTotal(item)
        productRevenue[key].qty += item.quantity || 1
      }
    }
    const topProducts = Object.values(productRevenue)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    return {
      todayRevenue,
      todayOrderCount: todayOrders.length,
      pendingRfqs: pendingRfqs.length,
      alertCount: dangerAlerts.length + emergencyRfqs.length,
      topProducts,
      emergencyRfqs,
      dangerAlerts,
    }
  }, [orders, rfqs, alerts])

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 mb-5">
        <ClipboardList size={18} className="text-[var(--accent-gold)]" />
        <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
          CEO Morning Brief
        </h2>
        <span className="ml-auto text-[0.625rem] text-[var(--text-muted)] font-medium">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
          <ShoppingCart size={16} className="mx-auto text-[var(--accent-gold)] mb-1" />
          <p className="font-display text-lg font-extrabold text-[var(--text-primary)]">
            ${brief.todayRevenue.toLocaleString()}
          </p>
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Revenue Today</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
          <FileText size={16} className="mx-auto text-[var(--accent-blue)] mb-1" />
          <p className="font-display text-lg font-extrabold text-[var(--text-primary)]">
            {brief.todayOrderCount}
          </p>
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Orders Today</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
          <FileText size={16} className="mx-auto text-[var(--accent-teal)] mb-1" />
          <p className="font-display text-lg font-extrabold text-[var(--text-primary)]">
            {brief.pendingRfqs}
          </p>
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Pending RFQs</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] p-3 text-center">
          <AlertTriangle size={16} className="mx-auto text-[var(--danger)] mb-1" />
          <p className="font-display text-lg font-extrabold text-[var(--text-primary)]">
            {brief.alertCount}
          </p>
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Active Alerts</p>
        </div>
      </div>

      {/* Top Products */}
      {brief.topProducts.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Top Products by Revenue
          </h3>
          <div className="space-y-1.5">
            {brief.topProducts.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1">
                <span className="text-[var(--text-secondary)] font-medium truncate">
                  <span className="text-[var(--text-muted)] mr-1">{i + 1}.</span>
                  {p.name}
                </span>
                <span className="font-mono font-bold text-[var(--text-primary)] ml-2 whitespace-nowrap">
                  ${p.revenue.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Emergency Alerts */}
      {brief.emergencyRfqs.length > 0 && (
        <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-3 mb-4">
          <p className="text-xs font-bold text-[var(--danger)] mb-2">
            🚨 Emergency RFQs Need Response
          </p>
          {brief.emergencyRfqs.slice(0, 3).map((rfq: any) => (
            <div key={rfq.id} className="flex items-center justify-between py-1">
              <span className="text-[0.625rem] text-[var(--text-secondary)] truncate">
                {rfq.fullName || rfq.company || 'Unknown'} — {rfq.productDescription?.slice(0, 50) || 'RFQ'}
              </span>
              <div className="flex gap-1 shrink-0 ml-2">
                <a href={`tel:${rfq.phone}`} className="rounded-md bg-[var(--accent-blue)]/10 p-1 text-[var(--accent-blue)]"><Phone size={10} /></a>
                <a href={`mailto:${rfq.email}`} className="rounded-md bg-[var(--accent-gold)]/10 p-1 text-[var(--accent-gold)]"><Mail size={10} /></a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/orders" className="admin-quick-action">
          <ShoppingCart size={14} /> View Orders <ArrowRight size={12} />
        </Link>
        <Link to="/admin/rfqs" className="admin-quick-action">
          <FileText size={14} /> View RFQs <ArrowRight size={12} />
        </Link>
        <Link to="/admin/products?filter=low-stock" className="admin-quick-action">
          <AlertTriangle size={14} /> Check Inventory <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}
