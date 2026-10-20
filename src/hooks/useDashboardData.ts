import { useState, useEffect, useCallback } from 'react'
import { admin } from '../lib/api'
import type { DashboardAlertsResponse, DashboardActivityResponse } from '../lib/api/admin'
import type {
  ApiDashboardStats, ApiOrder, ApiRfq, ApiOffer, ApiProduct, ApiCustomer,
} from '../lib/api-types'

interface DashboardAlert {
  id: string
  type: string
  message: string
  severity?: string
  [key: string]: unknown
}

interface DashboardActivityLog {
  id: string
  action: string
  actorEmail?: string
  entityType?: string
  entityName?: string
  createdAt: string
  [key: string]: unknown
}

export interface DashboardInsightData {
  stats: ApiDashboardStats | null
  alerts: DashboardAlert[]
  activity: DashboardActivityLog[]
  orders: ApiOrder[]
  rfqs: ApiRfq[]
  offers: ApiOffer[]
  products: ApiProduct[]
  customers: ApiCustomer[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** The admin list endpoints clamp `limit` to 100, so analytics data has to be
 *  collected across pages instead of asking for one oversized page. */
const DASHBOARD_PAGE_SIZE = 100

async function collectPages<T>(
  loadPage: (page: number) => Promise<{ items: T[]; totalPages: number }>,
  maxItems: number,
): Promise<T[]> {
  const first = await loadPage(1)
  const items = [...first.items]
  const pageCount = Math.min(
    first.totalPages || 1,
    Math.ceil(maxItems / DASHBOARD_PAGE_SIZE),
  )
  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) => loadPage(index + 2)),
    )
    for (const page of rest) items.push(...page.items)
  }
  return items.slice(0, maxItems)
}

export function useDashboardData(): DashboardInsightData {
  const [stats, setStats] = useState<ApiDashboardStats | null>(null)
  const [alerts, setAlerts] = useState<DashboardAlert[]>([])
  const [activity, setActivity] = useState<DashboardActivityLog[]>([])
  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [rfqs, setRfqs] = useState<ApiRfq[]>([])
  const [offers, setOffers] = useState<ApiOffer[]>([])
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [customers, setCustomers] = useState<ApiCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.allSettled([
        admin.dashboard.stats(),
        admin.dashboard.alerts(),
        admin.dashboard.activity(50),
        collectPages(async (page) => {
          const res = await admin.orders.list({ page: String(page), limit: String(DASHBOARD_PAGE_SIZE) })
          return { items: res.orders || [], totalPages: res.pagination?.totalPages || 1 }
        }, 200),
        collectPages(async (page) => {
          const res = await admin.rfqs.list({ page: String(page), limit: String(DASHBOARD_PAGE_SIZE) })
          return { items: res.rfqs || [], totalPages: res.pagination?.totalPages || 1 }
        }, 100),
        collectPages(async (page) => {
          const res = await admin.offers.list({ page: String(page), limit: String(DASHBOARD_PAGE_SIZE) })
          return { items: res.offers || [], totalPages: res.pagination?.totalPages || 1 }
        }, 100),
        collectPages(async (page) => {
          const res = await admin.products.list({ page: String(page), limit: String(DASHBOARD_PAGE_SIZE) })
          return { items: res.products || [], totalPages: res.pagination?.totalPages || 1 }
        }, 500),
        collectPages(async (page) => {
          const res = await admin.customers.list({ page: String(page), limit: String(DASHBOARD_PAGE_SIZE) })
          return { items: res.customers || [], totalPages: res.pagination?.totalPages || 1 }
        }, 200),
      ])

      if (results[0].status === 'fulfilled') setStats(results[0].value as ApiDashboardStats)
      if (results[1].status === 'fulfilled') {
        const a = results[1].value as DashboardAlertsResponse
        const built: DashboardAlert[] = []
        if ((a.lowStockCount ?? a.lowStockProducts?.length ?? 0) > 0) {
          built.push({ id: 'low-stock', type: 'warning', message: `${a.lowStockCount ?? a.lowStockProducts.length} products are low on stock`, entityType: 'product' })
        }
        if (a.overdueRfqs?.length) {
          built.push({ id: 'overdue-rfqs', type: 'danger', message: `${a.overdueRfqs.length} RFQs have exceeded response SLA`, entityType: 'rfq' })
        }
        if ((a.outOfStockCount ?? 0) > 0) {
          built.push({ id: 'out-of-stock', type: 'danger', message: `${a.outOfStockCount} products are out of stock`, entityType: 'product' })
        }
        setAlerts(built)
      }
      if (results[2].status === 'fulfilled') {
        const val = results[2].value as DashboardActivityResponse
        setActivity((val?.logs || []).map((l) => ({
          id: l.id,
          action: l.action,
          actorEmail: l.actorEmail || undefined,
          entityType: l.entityType || undefined,
          entityName: l.entityName || undefined,
          createdAt: l.createdAt,
        })))
      }
      if (results[3].status === 'fulfilled') {
        setOrders(results[3].value as ApiOrder[])
      }
      if (results[4].status === 'fulfilled') {
        setRfqs(results[4].value as ApiRfq[])
      }
      if (results[5].status === 'fulfilled') {
        setOffers(results[5].value as ApiOffer[])
      }
      if (results[6].status === 'fulfilled') {
        setProducts(results[6].value as ApiProduct[])
      }
      if (results[7].status === 'fulfilled') {
        setCustomers(results[7].value as ApiCustomer[])
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { stats, alerts, activity, orders, rfqs, offers, products, customers, loading, error, refresh }
}
