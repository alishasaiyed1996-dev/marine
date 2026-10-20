import { useState, useMemo, useEffect, useCallback } from 'react'
import { Search, Users, Eye, DollarSign, ShoppingCart, Star, Loader2, Plus, Globe } from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { AdminPagination } from '../../components/admin/AdminPagination'
import { CustomerDetailSlideover } from '../../components/admin/customers/CustomerDetailSlideover'
import { CreateCustomerModal } from '../../components/admin/customers/CreateCustomerModal'
import type { CustomerOrder, CustomerStatus, CustomerType } from '../../components/admin/customers/types'
import { statusConfig } from '../../components/admin/customers/types'
import type { ApiCustomer } from '../../lib/api-types'

const ITEMS_PER_PAGE = 15

function mapApiCustomer(c: ApiCustomer): CustomerType {
  return {
    id: c.id,
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    company: c.company || '',
    country: c.country || '',
    city: c.city || '',
    address: c.address || '',
    website: c.website || '',
    status: (c.status || 'active') as CustomerStatus,
    joinedDate: c.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0],
    lastOrderDate: c.lastOrderAt?.split('T')[0] || '',
    totalOrders: c._count?.orders ?? 0,
    totalSpent: c.totalSpent ?? 0,
    avgOrderValue: c._count?.orders ? Math.round((c.totalSpent ?? 0) / c._count.orders) : 0,
    orders: [],
    tags: c.tags || [],
    notes: c.internalNotes || c.notes || '',
  }
}

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminCustomers() {
  const { toast } = useToast()
  const [customers, setCustomers] = useState<CustomerType[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | ''>('')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerType | null>(null)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)
  const [serverStatusCounts, setServerStatusCounts] = useState<Record<string, number>>({})
  const [serverStats, setServerStats] = useState({ totalRevenue: 0, avgLifetimeValue: 0, vipCount: 0, activeCount: 0 })

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (statusFilter) params.status = statusFilter
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      const res = await admin.customers.list(params)
      setCustomers((res.customers || []).map(mapApiCustomer))
      setServerTotal(res.pagination?.total ?? 0)
      setServerStatusCounts(res.statusCounts || {})
      if (res.stats) setServerStats(res.stats)
    } catch (err: unknown) {
      console.error('Failed to load customers:', err)
      toast('Failed to load customers', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, page, toast])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  // The list endpoint omits order history, so load the detail (which includes
  // recent orders) whenever a customer is opened in the slide-over.
  const selectedId = selectedCustomer?.id ?? null
  useEffect(() => {
    if (!selectedId) return
    let active = true
    admin.customers.get(selectedId)
      .then((res) => {
        if (!active) return
        const orders: CustomerOrder[] = (res.customer.orders ?? []).map((o) => ({
          id: o.orderNumber || o.id,
          date: o.createdAt,
          total: Number(o.total ?? 0),
          status: (o.status || 'pending') as CustomerOrder['status'],
          itemCount: o._count?.items ?? 0,
        }))
        setCustomers((prev) => prev.map((c) => (c.id === selectedId ? { ...c, orders } : c)))
        setSelectedCustomer((prev) => (prev && prev.id === selectedId ? { ...prev, orders } : prev))
      })
      .catch(() => { /* detail is optional; keep whatever the list gave us */ })
    return () => { active = false }
  }, [selectedId])

  const filteredCustomers = useMemo(() => {
    let result = [...customers]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company.toLowerCase().includes(q) ||
          c.country.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    if (statusFilter) {
      result = result.filter((c) => c.status === statusFilter)
    }
    return result
  }, [customers, search, statusFilter])

  // Server paginates/filters; the client pass only refines within the page.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginatedCustomers = filteredCustomers.slice(0, ITEMS_PER_PAGE)

  // Totals come from the server so they cover every matching customer, not
  // just the current page.
  const stats = serverStats

  return (
    <div className="space-y-5">
      {/* Header + Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Customers</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{serverTotal} customer{serverTotal === 1 ? '' : 's'} found</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-bold text-[var(--btn-blue-text)] hover:shadow-[0_4px_12px_rgba(232,170,36,0.3)] transition-all">
          <Plus size={14} /> Add Customer
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue', value: `$${stats.totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-[var(--success)]' },
          { label: 'Avg. Lifetime Value', value: `$${stats.avgLifetimeValue.toLocaleString()}`, icon: ShoppingCart, color: 'text-[var(--accent-blue)]' },
          { label: 'VIP Customers', value: stats.vipCount.toString(), icon: Star, color: 'text-[var(--accent-gold)]' },
          { label: 'Active Customers', value: stats.activeCount.toString(), icon: Users, color: 'text-[var(--accent-teal)]' },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="admin-stat-card">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className={stat.color} />
                <span className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">{stat.label}</span>
              </div>
              <p className="font-display text-lg font-extrabold text-[var(--text-primary)]">{stat.value}</p>
            </div>
          )
        })}
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => { setStatusFilter(''); setPage(1) }}
          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${statusFilter === '' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)] shadow-[0_4px_12px_rgba(232,170,36,0.2)]' : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
          All ({serverTotal})
        </button>
        {(Object.keys(statusConfig) as CustomerStatus[]).map((status) => (
          <button key={status} onClick={() => { setStatusFilter(status === statusFilter ? '' : status); setPage(1) }}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${statusFilter === status ? `${statusConfig[status].bg} ${statusConfig[status].color} border border-current/20` : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'}`}>
            {statusConfig[status].label} ({serverStatusCounts[status] || 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search by name, email, company, country, or tags..." value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      {/* Customers Table */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Country</th>
                <th>Orders</th>
                <th>Total Spent</th>
                <th>Status</th>
                <th>Last Order</th>
                <th className="w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <div className="flex items-center justify-center gap-3">
                      <Loader2 size={20} className="animate-spin text-[var(--accent-gold)]" />
                      <span className="text-sm text-[var(--text-muted)]">Loading customers...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <Users size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
                    <p className="text-sm font-semibold text-[var(--text-muted)]">No customers found</p>
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map((customer) => (
                  <tr key={customer.id} className="cursor-pointer hover:bg-[var(--surface-soft)]" onClick={() => setSelectedCustomer(customer)}>
                    <td>
                      <div>
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{customer.name}</p>
                        <p className="text-[0.625rem] text-[var(--text-muted)]">{customer.email}</p>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Globe size={10} className="text-[var(--text-muted)]" />
                        <span className="text-xs text-[var(--text-secondary)]">{customer.country}</span>
                      </div>
                    </td>
                    <td className="text-xs font-bold text-[var(--text-primary)]">{customer.totalOrders}</td>
                    <td className="font-mono text-xs font-bold text-[var(--success)]">${customer.totalSpent.toLocaleString()}</td>
                    <td>
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-bold ${statusConfig[customer.status].bg} ${statusConfig[customer.status].color}`}>
                        {customer.status === 'vip' && <Star size={10} />}
                        {statusConfig[customer.status].label}
                      </span>
                    </td>
                    <td className="text-xs text-[var(--text-muted)]">{formatDate(customer.lastOrderDate)}</td>
                    <td>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedCustomer(customer) }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors">
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {/* Customer Detail Slide-over */}
      {selectedCustomer && (
        <CustomerDetailSlideover
          key={selectedCustomer.id}
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onStatusChange={async (id, status) => {
            const previousStatus = customers.find((c) => c.id === id)?.status
            const previousSelectedStatus = selectedCustomer.status
            setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, status } : c))
            setSelectedCustomer((prev) => (prev && prev.id === id ? { ...prev, status } : prev))
            try {
              await admin.customers.updateStatus(id, status)
            } catch (err) {
              // Roll back the optimistic badge if the API rejected the change.
              if (previousStatus) {
                setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, status: previousStatus } : c))
              }
              setSelectedCustomer((prev) => (
                prev && prev.id === id ? { ...prev, status: previousSelectedStatus } : prev
              ))
              throw err
            }
          }}
          onSaveNotes={async (id, notes) => {
            await admin.customers.addNote(id, notes)
            setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, notes } : c))
            setSelectedCustomer((prev) => (prev && prev.id === id ? { ...prev, notes } : prev))
          }}
          onSaveDetails={async (id, data) => {
            await admin.customers.update(id, data)
            setCustomers((prev) => prev.map((c) => c.id === id ? { ...c, ...data } : c))
            setSelectedCustomer((prev) => (prev && prev.id === id ? { ...prev, ...data } : prev))
          }}
          onToast={toast}
          onCustomersUpdate={(updater) => setCustomers(updater)}
        />
      )}

      {/* Create Customer Modal */}
      <CreateCustomerModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => fetchCustomers()}
        onToast={toast}
        onCreateCustomer={async (data) => {
          await admin.customers.create(data)
        }}
      />
    </div>
  )
}
