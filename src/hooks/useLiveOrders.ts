import { useState, useEffect, useCallback, useRef } from 'react'
import { admin } from '../lib/api'
import type { ApiOrder } from '../lib/api-types'

export function useLiveOrders(intervalMs = 30000) {
  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchOrders = useCallback(async () => {
    try {
      // listOrders already returns newest-first (createdAt desc server-side).
      const res = await admin.orders.list({ limit: '20' })
      setOrders(res?.orders || [])
    } catch (err) {
      console.warn('[useLiveOrders] Fetch failed, will retry on next interval:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchOrders()
    intervalRef.current = setInterval(fetchOrders, intervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchOrders, intervalMs])

  return { orders, loading, refresh: fetchOrders }
}
