import { useState, useEffect, useCallback } from 'react'
import { Wifi, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'
import { getAdminToken } from '../../../lib/api'

interface Endpoint {
  id: string
  name: string
  path: string
  method: string
}

interface CheckResult {
  id: string
  name: string
  path: string
  status: 'ok' | 'error' | 'checking' | 'unknown'
  responseTime: number | null
  statusCode: number | null
  lastChecked: Date | null
  history: Array<{ time: number; ok: boolean; responseTime: number }>
}

const ENDPOINTS: Endpoint[] = [
  { id: 'home', name: 'Homepage', path: '/', method: 'GET' },
  { id: 'products', name: 'Products API', path: '/api/storefront/products', method: 'GET' },
  { id: 'brands', name: 'Brands API', path: '/api/storefront/brands', method: 'GET' },
  { id: 'categories', name: 'Categories API', path: '/api/storefront/categories', method: 'GET' },
  { id: 'industries', name: 'Industries API', path: '/api/storefront/industries', method: 'GET' },
  // RFQ has no GET route; OPTIONS exercises the mounted router without
  // creating an RFQ. The admin stats endpoint requires the admin bearer token.
  { id: 'rfq', name: 'RFQ Endpoint', path: '/api/storefront/rfq', method: 'OPTIONS' },
  { id: 'search', name: 'Search API', path: '/api/storefront/products?search=test', method: 'GET' },
  { id: 'admin', name: 'Admin Auth', path: '/api/admin/dashboard/stats', method: 'GET' },
]

export function ApiStatusMonitor() {
  const [results, setResults] = useState<CheckResult[]>(
    ENDPOINTS.map(ep => ({
      id: ep.id, name: ep.name, path: ep.path, status: 'unknown',
      responseTime: null, statusCode: null, lastChecked: null, history: [],
    }))
  )
  const [checking, setChecking] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const checkEndpoints = useCallback(async () => {
    setChecking(true)
    const baseUrl = window.location.origin
    const token = getAdminToken()

    const newResults = await Promise.all(
      ENDPOINTS.map(async (ep) => {
        const start = performance.now()
        try {
          const response = await fetch(baseUrl + ep.path, {
            method: ep.method,
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: AbortSignal.timeout(10000),
          })
          const responseTime = Math.round(performance.now() - start)
          return {
            id: ep.id, name: ep.name, path: ep.path,
            status: response.ok ? 'ok' as const : 'error' as const,
            responseTime, statusCode: response.status, lastChecked: new Date(),
            history: [] as Array<{ time: number; ok: boolean; responseTime: number }>,
          }
        } catch {
          console.warn('[ApiStatusMonitor] Check failed:', ep.name, ep.path)
          return {
            id: ep.id, name: ep.name, path: ep.path,
            status: 'error' as const, responseTime: Math.round(performance.now() - start),
            statusCode: null, lastChecked: new Date(),
            history: [] as Array<{ time: number; ok: boolean; responseTime: number }>,
          }
        }
      })
    )

    setResults(prev => prev.map((r, i) => ({
      ...newResults[i],
      history: [...r.history, { time: Date.now(), ok: newResults[i].status === 'ok', responseTime: newResults[i].responseTime || 0 }].slice(-20),
    })))
    setChecking(false)
  }, [])

  useEffect(() => { checkEndpoints() }, [checkEndpoints])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(checkEndpoints, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, checkEndpoints])

  const okCount = results.filter(r => r.status === 'ok').length
  const errorCount = results.filter(r => r.status === 'error').length
  const avgResponseTime = results.filter(r => r.responseTime !== null).reduce((s, r) => s + (r.responseTime || 0), 0) /
    Math.max(1, results.filter(r => r.responseTime !== null).length)
  const uptime = results.reduce((s, r) => {
    const successes = r.history.filter(h => h.ok).length
    return s + (r.history.length > 0 ? successes / r.history.length : r.status === 'ok' ? 1 : 0)
  }, 0) / Math.max(1, results.length) * 100

  const overallStatus = errorCount === 0 ? 'operational' : errorCount <= 1 ? 'degraded' : 'outage'

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wifi size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">API Status Monitor</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAutoRefresh(!autoRefresh)}
            className={`rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${autoRefresh ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}>
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button onClick={checkEndpoints} disabled={checking}
            className="flex items-center gap-1 rounded-lg bg-[var(--surface-soft)] px-2 py-1 text-[0.625rem] font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50">
            <RefreshCw size={10} className={checking ? 'animate-spin' : ''} /> Check
          </button>
        </div>
      </div>

      {/* Overall status banner */}
      <div className={`flex items-center gap-2 rounded-xl p-3 mb-4 ${
        overallStatus === 'operational' ? 'bg-[var(--success)]/10 border border-[var(--success)]/20'
        : overallStatus === 'degraded' ? 'bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/20'
        : 'bg-[var(--danger)]/10 border border-[var(--danger)]/20'
      }`}>
        {overallStatus === 'operational' ? <CheckCircle size={16} className="text-[var(--success)]" /> :
         overallStatus === 'degraded' ? <Clock size={16} className="text-[var(--accent-gold)]" /> :
         <XCircle size={16} className="text-[var(--danger)]" />}
        <div>
          <p className="text-xs font-bold text-[var(--text-primary)] capitalize">{overallStatus}</p>
          <p className="text-[0.625rem] text-[var(--text-muted)]">{okCount}/{results.length} endpoints · {uptime.toFixed(1)}% uptime · Avg {avgResponseTime.toFixed(0)}ms</p>
        </div>
      </div>

      {/* Endpoint list with mini sparklines */}
      <div className="space-y-1.5">
        {results.map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {r.status === 'ok' ? <CheckCircle size={12} className="text-[var(--success)] shrink-0" /> :
               r.status === 'error' ? <XCircle size={12} className="text-[var(--danger)] shrink-0" /> :
               <RefreshCw size={12} className="text-[var(--text-muted)] shrink-0 animate-spin" />}
              <div>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{r.name}</span>
                <span className="text-[0.5rem] text-[var(--text-muted)] ml-2">{r.path}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Mini sparkline from history */}
              {r.history.length > 1 && (
                <div className="flex items-end gap-px h-3">
                  {r.history.slice(-10).map((h, i) => (
                    <div key={i} className={`w-1 rounded-sm ${h.ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`}
                      style={{ height: `${Math.max(20, Math.min(100, (h.responseTime / 5000) * 100))}%` }} />
                  ))}
                </div>
              )}
              {r.statusCode && (
                <span className={`text-[0.5rem] font-mono font-bold ${r.statusCode < 400 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{r.statusCode}</span>
              )}
              {r.responseTime !== null && (
                <span className={`text-[0.625rem] font-mono font-bold ${r.responseTime < 500 ? 'text-[var(--success)]' : r.responseTime < 2000 ? 'text-[var(--accent-gold)]' : 'text-[var(--danger)]'}`}>{r.responseTime}ms</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
