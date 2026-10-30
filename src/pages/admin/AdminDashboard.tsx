import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  FileText,
  FolderPlus,
  HandCoins,
  ImageOff,
  Mail,
  Package,
  Plus,
  ShoppingCart,
  Store,
  TrendingDown,
  Upload,
  Users,
  Warehouse,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAdminDashboard } from '../../hooks/useAdminDashboard'
import { useStore } from '../../store/useStore'

const quickActions = [
  { label: 'Add product', icon: <Plus size={14} />, to: '/admin/products/new' },
  { label: 'Upload images', icon: <Upload size={14} />, to: '/admin/media' },
  { label: 'New category', icon: <FolderPlus size={14} />, to: '/admin/categories' },
  { label: 'View RFQs', icon: <FileText size={14} />, to: '/admin/rfqs' },
  { label: 'View orders', icon: <ShoppingCart size={14} />, to: '/admin/orders' },
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

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const numberFormatter = new Intl.NumberFormat('en-US')

function formatCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0)
}

function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface SectionCardProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
  children: ReactNode
}

function SectionCard({ title, description, action, icon, className = '', children }: SectionCardProps) {
  return (
    <section className={`admin-card flex flex-col ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>}
        </div>
        {action ?? (icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-[var(--text-muted)]">
            {icon}
          </span>
        ))}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  )
}

interface StatCardProps {
  label: string
  value: string
  hint: string
  icon: ReactNode
  accent: string
  progress?: number
  to?: string
  loading: boolean
}

function StatCard({ label, value, hint, icon, accent, progress, to, loading }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
          <p className="mt-2 font-display text-[1.75rem] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
            {loading
              ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-[var(--surface-soft)]" />
              : value}
          </p>
        </div>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      {typeof progress === 'number' && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%`, background: accent }}
          />
        </div>
      )}
      <p className="mt-3 text-[0.6875rem] font-medium text-[var(--text-muted)]">{hint}</p>
    </>
  )

  if (to) {
    return <Link to={to} className="admin-stat-card no-underline">{body}</Link>
  }
  return <div className="admin-stat-card">{body}</div>
}

interface QueueCardProps {
  label: string
  value: number
  hint: string
  icon: ReactNode
  accent: string
  to: string
}

function QueueCard({ label, value, hint, icon, accent, to }: QueueCardProps) {
  return (
    <Link to={to} className="admin-stat-card group no-underline">
      <div className="flex items-center justify-between">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <ArrowUpRight
          size={14}
          className="text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 font-display text-2xl font-extrabold tabular-nums leading-none text-[var(--text-primary)]">
        {formatNumber(value)}
      </p>
      <p className="mt-1 text-xs font-bold text-[var(--text-secondary)]">{label}</p>
      <p className="mt-0.5 text-[0.6875rem] text-[var(--text-muted)]">{hint}</p>
    </Link>
  )
}

export default function AdminDashboard() {
  const { stats: dashboard, activity, alerts: dashboardAlerts, loading } = useAdminDashboard()
  const adminUser = useStore((s) => s.adminUser)

  const firstName = adminUser?.name?.trim().split(/\s+/)[0]
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  const pending = loading && dashboard.totalProducts === 0

  const displayedAlerts = [
    ...(dashboard.outOfStockProducts > 0
      ? [{
          type: 'danger' as const,
          icon: <AlertTriangle size={15} />,
          message: `${dashboard.outOfStockProducts} product${dashboard.outOfStockProducts === 1 ? '' : 's'} out of stock`,
          link: '/admin/products?filter=out-of-stock',
        }]
      : []),
    ...(dashboard.missingImageCount > 0
      ? [{
          type: 'warning' as const,
          icon: <ImageOff size={15} />,
          message: `${dashboard.missingImageCount} product${dashboard.missingImageCount === 1 ? '' : 's'} missing images`,
          link: '/admin/products?filter=missing-images',
        }]
      : []),
    ...(dashboard.lowStockCount > 0
      ? [{
          type: 'info' as const,
          icon: <TrendingDown size={15} />,
          message: `${dashboard.lowStockCount} product${dashboard.lowStockCount === 1 ? '' : 's'} low on stock`,
          link: '/admin/products?filter=low-stock',
        }]
      : []),
    ...(dashboardAlerts.length > 0
      ? dashboardAlerts.filter((alert) => alert.entityType !== 'product').map((alert) => ({
          type: alert.type as 'info' | 'danger' | 'warning',
          icon: alert.type === 'danger' ? <AlertTriangle size={15} /> : <Clock size={15} />,
          message: alert.message,
          link: entityHref(alert.entityType),
        }))
      : []),
  ]

  const kpis = [
    {
      label: 'Products',
      value: formatNumber(dashboard.totalProducts),
      hint: `${formatNumber(dashboard.inStockProducts)} in stock · ${formatNumber(dashboard.outOfStockProducts)} out`,
      icon: <Package size={18} />,
      accent: 'var(--accent-teal)',
      progress: dashboard.totalProducts > 0
        ? Math.round((dashboard.inStockProducts / dashboard.totalProducts) * 100)
        : 0,
      to: '/admin/products',
    },
    {
      label: 'Stock units',
      value: formatNumber(dashboard.totalStockUnits),
      hint: `${formatNumber(dashboard.emergencyProducts)} emergency-ready`,
      icon: <Warehouse size={18} />,
      accent: 'var(--accent-gold)',
      to: '/admin/products?filter=low-stock',
    },
    {
      label: 'Orders',
      value: formatNumber(dashboard.totalOrders),
      hint: `${formatNumber(dashboard.pendingOrders)} awaiting action`,
      icon: <ShoppingCart size={18} />,
      accent: 'var(--accent-blue)',
      to: '/admin/orders',
    },
    {
      label: 'Revenue',
      value: formatCurrency(dashboard.totalRevenue),
      hint: `${formatNumber(dashboard.totalCustomers)} customers on file`,
      icon: <HandCoins size={18} />,
      accent: 'var(--success)',
      to: '/admin/insights',
    },
  ]

  const queue = [
    { label: 'Pending orders', value: dashboard.pendingOrders, hint: `${formatNumber(dashboard.totalOrders)} total`, icon: <ShoppingCart size={16} />, accent: 'var(--accent-blue)', to: '/admin/orders' },
    { label: 'New RFQs', value: dashboard.newRfqs, hint: `${formatNumber(dashboard.totalRfqs)} total`, icon: <FileText size={16} />, accent: 'var(--accent-gold)', to: '/admin/rfqs' },
    { label: 'New offers', value: dashboard.newOffers, hint: `${formatNumber(dashboard.totalOffers)} total`, icon: <HandCoins size={16} />, accent: 'var(--success)', to: '/admin/offers' },
    { label: 'Unread messages', value: dashboard.newMessages, hint: 'Contact inbox', icon: <Mail size={16} />, accent: 'var(--accent-teal)', to: '/admin/messages' },
  ]

  const recentActivity = activity.length > 0
    ? activity.slice(0, 6).map((entry) => ({
        id: entry.id,
        action: entry.action,
        subject: entry.entityName || entry.entityType,
        actor: entry.actorEmail,
        time: formatTimestamp(entry.createdAt),
      }))
    : dashboard.lowStockProducts.slice(0, 5).map((product) => ({
        id: product.id,
        action: 'Low stock alert',
        subject: `${product.name} (${product.sku}) — ${product.stockCount} units left`,
        actor: 'system',
        time: 'Now',
      }))

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="type-overline text-[var(--accent-primary)]">Overview</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-[var(--text-primary)]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Welcome back{firstName ? `, ${firstName}` : ''} · {today}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-xs font-bold text-[var(--text-secondary)] no-underline transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
          >
            <Store size={14} />
            View store
          </Link>
          <Link
            to="/admin/products/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-3.5 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] no-underline transition-colors hover:bg-[var(--accent-primary-hover)]"
          >
            <Plus size={14} />
            New product
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {displayedAlerts.length > 0 && (
        <div className="space-y-2">
          {displayedAlerts.map((alert, index) => (
            <Link
              key={`${alert.link}-${index}`}
              to={alert.link}
              className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-xs font-bold no-underline transition-colors ${
                alert.type === 'danger'
                  ? 'border-[var(--danger-border)] bg-[var(--danger-subtle)] text-[var(--danger)] hover:bg-[var(--danger-glow)]'
                  : alert.type === 'warning'
                  ? 'border-[var(--warning-border)] bg-[var(--warning-subtle)] text-[var(--admin-badge-draft-text)]'
                  : 'border-[var(--info-border)] bg-[var(--info-subtle)] text-[var(--admin-badge-info-text)]'
              }`}
            >
              <span className="shrink-0">{alert.icon}</span>
              <span className="min-w-0 flex-1">{alert.message}</span>
              <ArrowRight size={14} className="shrink-0 opacity-60" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            icon={kpi.icon}
            accent={kpi.accent}
            progress={kpi.progress}
            to={kpi.to}
            loading={pending}
          />
        ))}
      </div>

      {/* Operations queue */}
      <div>
        <div className="mb-2.5 flex items-end justify-between gap-3">
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Needs your attention</h2>
          <span className="text-[0.6875rem] font-semibold text-[var(--text-muted)]">Live queue</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {queue.map((item) => (
            <QueueCard
              key={item.label}
              label={item.label}
              value={item.value}
              hint={item.hint}
              icon={item.icon}
              accent={item.accent}
              to={item.to}
            />
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="admin-card flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Quick actions</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">Jump straight into the most common catalog tasks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link key={action.label} to={action.to} className="admin-quick-action">
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Catalog + activity */}
      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Products by category"
          description="Top categories by catalog share"
          action={
            <Link
              to="/admin/categories"
              className="shrink-0 text-xs font-bold text-[var(--accent-primary)] no-underline hover:underline"
            >
              Manage →
            </Link>
          }
        >
          {dashboard.categoryBreakdown.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-muted)]">
              No category data yet — add products to see the breakdown.
            </p>
          ) : (
            <div className="space-y-3">
              {dashboard.categoryBreakdown.slice(0, 8).map((category) => (
                <div key={category.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-[var(--text-secondary)]">{category.name}</span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--text-primary)]">
                      {formatNumber(category.count)}
                      <span className="ml-1.5 font-sans text-[0.625rem] font-medium text-[var(--text-muted)]">
                        {category.percentage}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-soft)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-teal)] transition-all duration-500"
                      style={{ width: `${Math.max(2, category.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          description="Audit trail from the last actions"
          action={adminUser?.role === 'owner' ? (
            <Link
              to="/admin/audit-log"
              className="shrink-0 text-xs font-bold text-[var(--accent-primary)] no-underline hover:underline"
            >
              All →
            </Link>
          ) : undefined}
        >
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <Activity size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
              <p className="text-xs text-[var(--text-muted)]">
                {loading ? 'Loading activity…' : 'No recent activity yet.'}
              </p>
            </div>
          ) : (
            <ol className="relative space-y-3.5">
              {recentActivity.map((item, index) => (
                <li key={item.id} className="relative flex gap-3">
                  <span className="relative flex flex-col items-center">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--teal-soft)] text-[var(--accent-primary)]">
                      <Package size={12} aria-hidden="true" />
                    </span>
                    {index < recentActivity.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-[var(--border)]" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 pb-1">
                    <span className="block truncate text-xs font-bold capitalize text-[var(--text-primary)]">{item.action}</span>
                    <span className="block truncate text-[0.6875rem] text-[var(--text-muted)]">{item.subject}</span>
                    <span className="mt-0.5 block truncate text-[0.625rem] text-[var(--text-muted)]">
                      {item.actor} · {item.time}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      {/* Condition + brands */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Products by condition"
          description="New versus used stock mix"
          icon={<Activity size={15} />}
        >
          {dashboard.conditionBreakdown.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-muted)]">No condition data yet.</p>
          ) : (
            <div className="space-y-3">
              {dashboard.conditionBreakdown.map((item) => {
                const color = item.condition === 'new'
                  ? 'var(--success)'
                  : item.condition === 'used'
                  ? 'var(--accent-blue)'
                  : item.condition === 'refurbished'
                  ? 'var(--accent-gold)'
                  : item.condition === 'reconditioned'
                  ? 'var(--accent-teal)'
                  : 'var(--text-muted)'
                return (
                  <div key={item.condition} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold capitalize text-[var(--text-secondary)]">
                      {item.condition}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--text-primary)]">
                      {formatNumber(item.count)}
                    </span>
                    <span className="w-10 shrink-0 text-right text-[0.625rem] font-medium text-[var(--text-muted)]">
                      {item.percentage}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Top brands"
          description="Ranked by product count"
          action={
            <Link
              to="/admin/brands"
              className="shrink-0 text-xs font-bold text-[var(--accent-primary)] no-underline hover:underline"
            >
              Manage →
            </Link>
          }
        >
          {dashboard.brandBreakdown.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-muted)]">No brands have products yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {dashboard.brandBreakdown.slice(0, 9).map((brand) => (
                <div
                  key={brand.name}
                  className="flex flex-col items-center rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-2.5 text-center"
                >
                  <span className="font-display text-base font-extrabold tabular-nums text-[var(--text-primary)]">
                    {formatNumber(brand.count)}
                  </span>
                  <span className="mt-0.5 w-full truncate text-[0.625rem] font-bold text-[var(--text-muted)]">
                    {brand.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Low stock */}
      {dashboard.lowStockProducts.length > 0 && (
        <section className="admin-card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Low stock products</h2>
              <span className="admin-badge admin-badge-danger">{formatNumber(dashboard.lowStockCount)}</span>
            </div>
            <Link
              to="/admin/products?filter=low-stock"
              className="text-xs font-bold text-[var(--accent-primary)] no-underline hover:underline"
            >
              View all →
            </Link>
          </header>
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
                    <td className="font-semibold text-[var(--text-primary)]">{product.name}</td>
                    <td className="font-mono text-xs">{product.sku}</td>
                    <td className="text-xs">{product.brand}</td>
                    <td className={`font-mono text-xs font-bold ${
                      product.stockCount <= 2 ? 'text-[var(--danger)]' : 'text-[var(--admin-badge-draft-text)]'
                    }`}>
                      {product.stockCount}
                    </td>
                    <td>
                      {product.stockCount === 0 ? (
                        <span className="admin-badge admin-badge-danger">Out of stock</span>
                      ) : product.stockCount <= 2 ? (
                        <span className="admin-badge admin-badge-danger">Critical</span>
                      ) : (
                        <span className="admin-badge admin-badge-draft">Low stock</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Catalog footprint */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Brands', value: dashboard.totalBrands, icon: <Users size={16} />, to: '/admin/brands' },
          { label: 'Categories', value: dashboard.totalCategories, icon: <BarChart3 size={16} />, to: '/admin/categories' },
          { label: 'Industries', value: dashboard.totalIndustries, icon: <Warehouse size={16} />, to: '/admin/industries' },
          { label: 'On sale', value: dashboard.saleProducts, icon: <HandCoins size={16} />, to: '/admin/products?filter=on-sale' },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 no-underline transition-colors hover:border-[var(--accent-primary)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-[var(--text-muted)]">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg font-extrabold tabular-nums leading-none text-[var(--text-primary)]">
                {formatNumber(item.value)}
              </span>
              <span className="mt-1 block text-[0.625rem] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {item.label}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
