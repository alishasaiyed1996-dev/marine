import { useState, useEffect, useCallback } from 'react'
import { admin } from '../lib/api'
import type { DashboardAlertsResponse, DashboardActivityResponse } from '../lib/api/admin'
import type { ApiDashboardStats } from '../lib/api-types'

export interface DashboardStats {
  totalProducts: number
  inStockProducts: number
  outOfStockProducts: number
  emergencyProducts: number
  saleProducts: number
  newArrivals: number
  totalBrands: number
  totalCategories: number
  totalIndustries: number
  totalStockUnits: number
  // Operations counts — surfaced on the dashboard so the panel reflects the
  // order/RFQ/offer/message queue, not just the catalog.
  totalOrders: number
  pendingOrders: number
  totalRevenue: number
  totalCustomers: number
  totalRfqs: number
  newRfqs: number
  totalOffers: number
  newOffers: number
  newMessages: number
  lowStockCount: number
  missingImageCount: number
  lowStockProducts: ProductAlert[]
  missingImageProducts: ProductAlert[]
  categoryBreakdown: CategoryBreakdown[]
  brandBreakdown: BrandBreakdown[]
  conditionBreakdown: ConditionBreakdown[]
}

const EMPTY_STATS: DashboardStats = {
  totalProducts: 0, inStockProducts: 0, outOfStockProducts: 0,
  emergencyProducts: 0, saleProducts: 0, newArrivals: 0,
  totalBrands: 0, totalCategories: 0, totalIndustries: 0,
  totalStockUnits: 0,
  totalOrders: 0, pendingOrders: 0, totalRevenue: 0, totalCustomers: 0,
  totalRfqs: 0, newRfqs: 0, totalOffers: 0, newOffers: 0, newMessages: 0,
  lowStockCount: 0, missingImageCount: 0,
  lowStockProducts: [], missingImageProducts: [],
  categoryBreakdown: [], brandBreakdown: [], conditionBreakdown: [],
}

interface ProductAlert {
  id: string
  name: string
  sku: string
  brand: string
  category: string
  stockCount: number
  availability: string
  hasImage: boolean
}

export interface CategoryBreakdown {
  id: string
  name: string
  count: number
  percentage: number
}

export interface BrandBreakdown {
  name: string
  count: number
  percentage: number
}

export interface ConditionBreakdown {
  condition: string
  count: number
  percentage: number
}

export interface DashboardActivity {
  id: string
  action: string
  entityType: string
  entityName: string
  actorEmail: string
  createdAt: string
}

interface DashboardAlert {
  type: 'danger' | 'warning' | 'info'
  message: string
  entityType?: string
}

export function useAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activity, setActivity] = useState<DashboardActivity[]>([])
  const [alerts, setAlerts] = useState<DashboardAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, alertsRes, activityRes] = await Promise.allSettled([
        admin.dashboard.stats(),
        admin.dashboard.alerts(),
        admin.dashboard.activity(20),
      ])

      // Process stats
      if (statsRes.status === 'fulfilled') {
        const s = statsRes.value as ApiDashboardStats
        const total = s.totalProducts || 0
        setStats({
          totalProducts: total,
          inStockProducts: s.inStockProducts || 0,
          outOfStockProducts: s.outOfStockProducts || 0,
          emergencyProducts: s.emergencyProducts || 0,
          saleProducts: s.saleProducts || 0,
          newArrivals: s.newArrivals || 0,
          totalBrands: s.totalBrands || 0,
          totalCategories: s.totalCategories || 0,
          totalIndustries: s.totalIndustries || 0,
          totalStockUnits: s.totalStockUnits || 0,
          totalOrders: s.totalOrders || 0,
          pendingOrders: s.pendingOrders || 0,
          totalRevenue: s.totalRevenue || 0,
          totalCustomers: s.totalCustomers || 0,
          totalRfqs: s.totalRfqs || 0,
          newRfqs: s.newRfqs || 0,
          totalOffers: s.totalOffers || 0,
          newOffers: s.newOffers || 0,
          newMessages: s.newMessages || 0,
          lowStockCount: s.lowStockCount ?? (s.lowStockProducts || []).length,
          missingImageCount: s.missingImageCount ?? (s.missingImageProducts || []).length,
          lowStockProducts: (s.lowStockProducts || []).map((p) => {
            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              brand: p.brand || 'Unknown',
              category: p.category || 'Unknown',
              stockCount: p.stockCount ?? 0,
              availability: p.availability || 'unknown',
              hasImage: !!(p.images?.length && p.images[0]?.url),
            }
          }),
          missingImageProducts: (s.missingImageProducts || []).map((p) => {
            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              brand: p.brand || 'Unknown',
              category: p.category || 'Unknown',
              stockCount: p.stockCount ?? 0,
              availability: p.availability || 'unknown',
              hasImage: false,
            }
          }),
          categoryBreakdown: (s.categoryBreakdown || []).map((c, i) => {
            return {
              id: c.id || `cat-${i}`,
              name: c.name || 'Unknown',
              count: c.count || 0,
              percentage: total > 0 ? Math.round(((c.count || 0) / total) * 100) : 0,
            }
          }).sort((a: CategoryBreakdown, b: CategoryBreakdown) => b.count - a.count),
          brandBreakdown: (s.brandBreakdown || []).map((b) => {
            return {
              name: b.name || 'Unknown',
              count: b.count || 0,
              percentage: total > 0 ? Math.round(((b.count || 0) / total) * 100) : 0,
            }
          }).sort((a: BrandBreakdown, b: BrandBreakdown) => b.count - a.count).slice(0, 15),
          conditionBreakdown: (s.conditionBreakdown || []).map((c) => {
            return {
              condition: c.condition || 'unknown',
              count: c.count || 0,
              percentage: total > 0 ? Math.round(((c.count || 0) / total) * 100) : 0,
            }
          }).sort((a: ConditionBreakdown, b: ConditionBreakdown) => b.count - a.count),
        })
      } else {
        // Fallback: compute from empty state
        setStats(EMPTY_STATS)
      }

      // Process alerts
      if (alertsRes.status === 'fulfilled') {
        const a = alertsRes.value as DashboardAlertsResponse
        const result: DashboardAlert[] = []
        if ((a.lowStockCount ?? a.lowStockProducts?.length ?? 0) > 0) {
          result.push({ type: 'warning', message: `${a.lowStockCount ?? a.lowStockProducts.length} products are low on stock`, entityType: 'product' })
        }
        if (a.overdueRfqs?.length) {
          result.push({ type: 'danger', message: `${a.overdueRfqs.length} RFQs have exceeded response SLA`, entityType: 'rfq' })
        }
        if ((a.outOfStockCount ?? 0) > 0) {
          result.push({ type: 'danger', message: `${a.outOfStockCount} products are out of stock`, entityType: 'product' })
        }
        setAlerts(result)
      }

      // Process activity
      if (activityRes.status === 'fulfilled') {
        const act = activityRes.value as DashboardActivityResponse
        setActivity((act?.logs || []).map((l) => ({
          id: l.id,
          action: l.action || 'unknown',
          entityType: l.entityType || 'unknown',
          entityName: l.entityName || l.entityType || '',
          actorEmail: l.actorEmail || 'system',
          createdAt: l.createdAt || new Date().toISOString(),
        })))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      // Set empty defaults so the UI still renders
      setStats(EMPTY_STATS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  return {
    stats: stats || EMPTY_STATS,
    activity,
    alerts,
    loading,
    error,
  }
}