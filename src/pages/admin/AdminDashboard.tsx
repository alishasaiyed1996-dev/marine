import {
  Package,
  ShoppingCart,
  FileText,
  HandCoins,
  AlertTriangle,
  Clock,
  Plus,
  Upload,
  FolderPlus,
  ArrowRight,
  BarChart3,
  Activity,
  TrendingDown,
  ImageOff,
  Boxes,
  Warehouse,
  Mail,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAdminDashboard } from '../../hooks/useAdminDashboard'

const quickActions = [
  { label: 'Add Product', icon: <Plus size={14} />, to: '/admin/products/new' },
  { label: 'Upload Images', icon: <Upload size={14} />, to: '/admin/media' },
  { label: 'New Category', icon: <FolderPlus size={14} />, to: '/admin/categories' },
  { label: 'View RFQs', icon: <FileText size={14} />, to: '/admin/rfqs' },
  { label: 'View Orders', icon: <ShoppingCart size={14} />, to: '/admin/orders' },
]

// Alert entityType → the admin route that lists those records. Naive
// `${entityType}s` produced dead links for contact_message/store_settings and
// mis-pluralised category/industry.
const ENTITY_ADMIN_PATH: Record<string, string> = {
  product: '/admin/products',
  order: '/admin/orders',
  rfq: '/admin/rfqs',
  offer: '/admin/offers',
  customer: '/admin/customers',
  contact_message: '/admin/messages',
  message: '/admin/messages',
  admin_user: '/admin/users',
  brand: '/admin/brands',
  category: '/admin/categories',
  industry: '/admin/industries',
  store_settings: '/admin/settings',
}

function entityHref(entityType?: string): string {
  return (entityType && ENTITY_ADMIN_PATH[entityType]) || '/admin/audit-log'
}

export default function AdminDashboard() {
  const { stats: dashboard, activity, alerts: dashboardAlerts, loading } = useAdminDashboard()

  // Build real-time alerts from dashboard data
  const displayedAlerts = [
    ...(dashboard.outOfStockProducts > 0
      ? [{
          type: 'danger' as const,
          icon: <AlertTriangle size={16} />,
          message: `${dashboard.outOfStockProducts} products are out of stock`,
          link: '/admin/products?filter=out-of-stock',
        }]
      : []),
    ...(dashboard.missingImageCount > 0
      ? [{
          type: 'warning' as const,
          icon: <ImageOff size={16} />,
          message: `${dashboard.missingImageCount} products have missing images`,
          link: '/admin/products?filter=missing-images',
        }]
      : []),
    ...(dashboard.lowStockCount > 0
      ? [{
          type: 'info' as const,
          icon: <TrendingDown size={16} />,
          message: `${dashboard.lowStockCount} products are low on stock (at or below their low-stock threshold)`,
          link: '/admin/products?filter=low-stock',
        }]
      : []),
    ...(dashboardAlerts.length > 0
      ? dashboardAlerts.filter(a => a.entityType !== 'product').map(a => ({
          type: a.type as 'info' | 'danger' | 'warning',
          icon: a.type === 'danger' ? <AlertTriangle size={16} /> : <Clock size={16} />,
          message: a.message,
          link: entityHref(a.entityType),
        }))
      : []),
  ]

  // Use real activity from API or low-stock products as fallback
  const recentActivity = activity.length > 0
    ? activity.slice(0, 6).map((a) => ({
        action: a.action,
        subject: a.entityName || a.entityType,
        time: new Date(a.createdAt).toLocaleString(),
        icon: <Package size={14} />,
      }))
    : dashboard.lowStockProducts.length > 0
      ? dashboard.lowStockProducts.slice(0, 5).map((p) => ({
          action: 'Low stock alert',
          subject: `${p.name} (${p.sku}) — ${p.stockCount} units remaining`,
          time: 'Now',
          icon: <Package size={14} />,
        }))
      : [{ action: loading ? 'Loading...' : 'No recent activity', subject: loading ? 'Fetching dashboard data' : 'Dashboard data will appear here', time: '', icon: <Activity size={14} /> }]

  const stats = [
    {
      label: 'Total Products',
      value: dashboard.totalProducts.toString(),
      change: `${dashboard.inStockProducts} in stock, ${dashboard.outOfStockProducts} out`,
      icon: <Package size={20} />,
      color: 'text-[var(--accent-blue)]',
      bg: 'bg-[var(--accent-blue)]/10',
    },
    {
      label: 'Total Stock Units',
      value: dashboard.totalStockUnits.toString(),
      change: `${dashboard.emergencyProducts} emergency available`,
      icon: <Warehouse size={20} />,
      color: 'text-[var(--accent-gold)]',
      bg: 'bg-[var(--accent-gold)]/10',
    },
    {
      label: 'Brands & Categories',
      value: `${dashboard.totalBrands}`,
      change: `${dashboard.totalCategories} categories, ${dashboard.totalIndustries} industries`,
      icon: <Boxes size={20} />,
      color: 'text-[var(--accent-teal)]',
      bg: 'bg-[var(--accent-teal)]/10',
    },
    {
      label: 'Sale & New Arrivals',
      value: `${dashboard.saleProducts + dashboard.newArrivals}`,
      change: `${dashboard.saleProducts} on sale, ${dashboard.newArrivals} new`,
      icon: <HandCoins size={20} />,
      color: 'text-[var(--success)]',
      bg: 'bg-[var(--success)]/10',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">
            Dashboard
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Store overview — {dashboard.totalProducts} products across {dashboard.totalBrands} brands
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] no-underline transition-all hover:brightness-95 hover:-translate-y-0.5"
          >
            <Plus size={14} />
            Add Product
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {displayedAlerts.length > 0 && (
        <div className="space-y-2">
          {displayedAlerts.map((alert, i) => (
            <Link
              key={i}
              to={alert.link}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold no-underline transition-all hover:-translate-y-0.5 ${
                alert.type === 'danger'
                  ? 'border-danger/20 bg-[var(--danger)]/10 text-danger hover:bg-[var(--danger)]/15'
                  : alert.type === 'warning'
                  ? 'border-[var(--accent-gold)]/20 bg-[var(--accent-gold)]/5 text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/10'
                  : 'border-[var(--accent-blue)]/20 bg-[var(--accent-blue)]/5 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10'
              }`}
            >
              {alert.icon}
              {alert.message}
              <ArrowRight size={14} className="ml-auto opacity-50" />
            </Link>
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="admin-stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {stat.label}
                </p>
                <p className="mt-2 font-display text-3xl font-extrabold text-[var(--text-primary)]">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)] font-medium">
                  {stat.change}
                </p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bg} ${stat.color}`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Operations Queue — counts the backend already returns but the page
          previously never surfaced (pending orders, new RFQs/offers/messages). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Pending Orders', value: dashboard.pendingOrders, sub: `${dashboard.totalOrders} total`, icon: <ShoppingCart size={20} />, color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', to: '/admin/orders' },
          { label: 'New RFQs', value: dashboard.newRfqs, sub: `${dashboard.totalRfqs} total`, icon: <FileText size={20} />, color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', to: '/admin/rfqs' },
          { label: 'New Offers', value: dashboard.newOffers, sub: `${dashboard.totalOffers} total`, icon: <HandCoins size={20} />, color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', to: '/admin/offers' },
          { label: 'Unread Messages', value: dashboard.newMessages, sub: 'Inbox', icon: <Mail size={20} />, color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', to: '/admin/messages' },
        ].map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="admin-stat-card no-underline transition-all hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {card.label}
                </p>
                <p className="mt-2 font-display text-3xl font-extrabold text-[var(--text-primary)]">
                  {card.value}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)] font-medium">
                  {card.sub}
                </p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.bg} ${card.color}`}>
                {card.icon}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="font-display text-sm font-bold text-[var(--text-primary)] mb-3">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              to={action.to}
              className="admin-quick-action"
            >
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Content Grid: Category Breakdown + Condition Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Products by Category
            </h2>
            <BarChart3 size={16} className="text-[var(--text-muted)]" />
          </div>
          <div className="space-y-2.5">
            {dashboard.categoryBreakdown.slice(0, 8).map((cat) => (
              <div key={cat.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">
                      {cat.name}
                    </span>
                    <span className="font-mono text-xs font-bold text-[var(--text-primary)] ml-2">
                      {cat.count}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--surface-soft)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-teal)] transition-all duration-500"
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Condition Breakdown */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Products by Condition
            </h2>
            <Activity size={16} className="text-[var(--text-muted)]" />
          </div>
          <div className="space-y-3">
            {dashboard.conditionBreakdown.map((item) => (
              <div key={item.condition} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${
                    item.condition === 'new'
                      ? 'bg-[var(--success)]'
                      : item.condition === 'used'
                      ? 'bg-[var(--accent-blue)]'
                      : item.condition === 'refurbished'
                      ? 'bg-[var(--accent-gold)]'
                      : item.condition === 'reconditioned'
                      ? 'bg-[var(--accent-teal)]'
                      : 'bg-[var(--text-muted)]'
                  }`} />
                  <span className="text-sm font-medium text-[var(--text-secondary)] capitalize">
                    {item.condition}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                    {item.count}
                  </span>
                  <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
                    ({item.percentage}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Recent Activity
          </h2>
          <Activity size={16} className="text-[var(--text-muted)]" />
        </div>
        <div className="space-y-3">
          {recentActivity.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-[var(--text-muted)] mt-0.5">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  {item.action}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {item.subject}
                </p>
              </div>
              <span className="text-[0.625rem] text-[var(--text-muted)] font-medium whitespace-nowrap">
                {item.time}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Low Stock Alerts Table */}
      {dashboard.lowStockProducts.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Stock Alerts — Low Stock Products ({dashboard.lowStockCount})
            </h2>
            <Link
              to="/admin/products?filter=low-stock"
              className="text-xs font-bold text-[var(--accent-gold)] hover:text-[var(--gold-light)] no-underline transition-colors"
            >
              View All →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Brand</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.lowStockProducts.slice(0, 10).map((product) => (
                  <tr key={product.id}>
                    <td className="font-semibold text-[var(--text-primary)]">
                      {product.name}
                    </td>
                    <td className="font-mono text-xs">{product.sku}</td>
                    <td className="text-xs">{product.brand}</td>
                    <td className={`font-mono text-xs font-bold ${
                      product.stockCount <= 2
                        ? 'text-[var(--danger)]'
                        : 'text-[var(--accent-gold)]'
                    }`}>
                      {product.stockCount}
                    </td>
                    <td>
                      {product.stockCount === 0 ? (
                        <span className="admin-badge admin-badge-danger">Out of Stock</span>
                      ) : product.stockCount <= 2 ? (
                        <span className="admin-badge admin-badge-danger">Critical</span>
                      ) : (
                        <span className="admin-badge admin-badge-draft">Low Stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Brands */}
      {dashboard.brandBreakdown.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Top Brands by Product Count
            </h2>
            <Link
              to="/admin/brands"
              className="text-xs font-bold text-[var(--accent-gold)] hover:text-[var(--gold-light)] no-underline transition-colors"
            >
              Manage Brands →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {dashboard.brandBreakdown.slice(0, 10).map((brand) => (
              <div
                key={brand.name}
                className="flex flex-col items-center rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-center transition-all hover:border-[var(--accent-gold)] hover:-translate-y-0.5"
              >
                <span className="font-display text-lg font-extrabold text-[var(--text-primary)]">
                  {brand.count}
                </span>
                <span className="text-[0.625rem] font-bold text-[var(--text-muted)] mt-0.5 truncate w-full">
                  {brand.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
