import { useState, useMemo, useEffect, useCallback } from 'react'
import { Download } from 'lucide-react'
import { admin } from '../../lib/api'
import { downloadCsv } from '../../lib/utils'
import { useToast } from '../../components/admin/toast-context'
import type { Order, OrderStatus } from './orders/types'
import { mapApiOrder, getNextStatuses, ITEMS_PER_PAGE } from './orders/types'
import { OrderFilters } from './orders/OrderFilters'
import { OrderTable } from './orders/OrderTable'
import { OrderDetailSlideOver } from './orders/OrderDetailSlideOver'
import { TrackingModal } from './orders/TrackingModal'

export default function AdminOrders() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)
  const [serverStatusCounts, setServerStatusCounts] = useState<Record<string, number>>({})
  const [showTrackingModal, setShowTrackingModal] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.from = dateFrom
      if (dateTo) params.to = dateTo
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      const res = await admin.orders.list(params)
      setOrders((res.orders || []).map(mapApiOrder))
      setServerTotal(res.pagination?.total ?? 0)
      setServerStatusCounts(res.statusCounts || {})
    } catch (err: unknown) {
      console.error('Failed to load orders:', err)
      toast('Failed to load orders', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, dateFrom, dateTo, page, toast])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // The server applies the search/status/date filters and returns exactly one
  // page. Re-filtering client-side would silently drop valid server matches
  // (e.g. guest shipping name/email) and break totals.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginatedOrders = orders

  const refreshSelectedOrder = useCallback(async (orderId: string) => {
    try {
      const { order } = await admin.orders.get(orderId)
      if (order) setSelectedOrder((current) => (current?.id === orderId ? mapApiOrder(order) : current))
    } catch (err) {
      console.error('Failed to refresh selected order:', err)
    }
  }, [])

  // "All" = every order matching the current search/date filters (not just the
  // page). The per-status tabs come straight from the server too.
  const allOrdersCount = useMemo(
    () => Object.values(serverStatusCounts).reduce((sum, n) => sum + n, 0),
    [serverStatusCounts]
  )

  const [exporting, setExporting] = useState(false)

  // Exports the full order dataset from the server (not just the current page).
  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const csv = await admin.orders.exportCsv()
      downloadCsv(csv, `orders-export-${new Date().toISOString().split('T')[0]}.csv`)
      toast('Orders exported to CSV', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleAdvanceStatus = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const next = getNextStatuses(order.status)
    if (next.length === 0) return
    try {
      await admin.orders.updateStatus(orderId, next[0].status)
      toast(`Order ${order.orderNumber} → ${next[0].label}`, 'success')
      await fetchOrders()
      await refreshSelectedOrder(orderId)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update status', 'error')
    }
  }

  const handleCancelOrder = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId)
    try {
      await admin.orders.cancel(orderId, 'Cancelled by admin')
      toast(`Order ${order?.orderNumber || orderId} cancelled`, 'success')
      await fetchOrders()
      await refreshSelectedOrder(orderId)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to cancel order', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">
            Orders
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {serverTotal} order{serverTotal === 1 ? '' : 's'} found
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] transition-all hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)] disabled:opacity-50"
        >
          <Download size={14} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <OrderFilters
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        setPage={setPage}
        ordersCount={allOrdersCount}
        statusCounts={serverStatusCounts}
      />

      <OrderTable
        loading={loading}
        paginatedOrders={paginatedOrders}
        setSelectedOrder={setSelectedOrder}
        page={page}
        totalPages={totalPages}
        setPage={setPage}
      />

      {/* Tracking Update Modal */}
      {showTrackingModal && selectedOrder && (
        <TrackingModal
          order={selectedOrder}
          onClose={() => setShowTrackingModal(false)}
          onSaved={() => { fetchOrders(); setShowTrackingModal(false); setSelectedOrder(null) }}
        />
      )}

      {/* Order Detail Slide-over */}
      {selectedOrder && !showTrackingModal && (
        <OrderDetailSlideOver
          order={selectedOrder}
          orders={orders}
          onClose={() => setSelectedOrder(null)}
          onAdvanceStatus={handleAdvanceStatus}
          onCancelOrder={handleCancelOrder}
          onOpenTracking={(order) => {
            setSelectedOrder(order)
            setShowTrackingModal(true)
          }}
          onRefresh={fetchOrders}
        />
      )}
    </div>
  )
}
