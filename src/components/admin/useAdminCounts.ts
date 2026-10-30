import { useEffect, useState } from 'react'
import { admin } from '../../lib/api'

/** Queue counts shown by the sidebar badges and the header bell. */
export interface AdminCounts {
  orders: number
  rfqs: number
  offers: number
  messages: number
}

export const EMPTY_ADMIN_COUNTS: AdminCounts = { orders: 0, rfqs: 0, offers: 0, messages: 0 }

// The sidebar and the header mount together and both need these numbers, so the
// request is cached at module scope. Without this the panel fired the same
// /admin/dashboard/stats call twice on every admin page load.
const TTL_MS = 60_000
let cache: { at: number; data: AdminCounts } | null = null
let inflight: Promise<AdminCounts> | null = null

function fetchCounts(): Promise<AdminCounts> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data)
  if (inflight) return inflight
  inflight = admin.dashboard
    .stats()
    .then((stats) => {
      const data: AdminCounts = {
        orders: stats.pendingOrders || 0,
        rfqs: stats.newRfqs || 0,
        offers: stats.newOffers || 0,
        messages: stats.newMessages || 0,
      }
      cache = { at: Date.now(), data }
      return data
    })
    .catch(() => EMPTY_ADMIN_COUNTS)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useAdminCounts(): AdminCounts {
  const [counts, setCounts] = useState<AdminCounts>(() => cache?.data ?? EMPTY_ADMIN_COUNTS)

  useEffect(() => {
    let cancelled = false
    void fetchCounts().then((data) => {
      if (!cancelled) setCounts(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return counts
}
