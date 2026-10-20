import { useState, useEffect } from 'react'
import { Globe, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'

interface Endpoint {
  id: string
  name: string
  url: string
  method: string
}

interface CheckResult {
  id: string
  name: string
  url: string
  status: 'ok' | 'error' | 'checking' | 'unknown'
  responseTime: number | null
  lastChecked: Date | null
  statusCode: number | null
}

const DEFAULT_ENDPOINTS: Endpoint[] = [
  { id: 'home', name: 'Homepage', url: '/', method: 'GET' },
  { id: 'products', name: 'Products API', url: '/api/storefront/products', method: 'GET' },
  { id: 'brands', name: 'Brands API', url: '/api/storefront/brands', method: 'GET' },
  { id: 'categories', name: 'Categories API', url: '/api/storefront/categories', method: 'GET' },
  // RFQ is POST-only; OPTIONS checks the mounted route without submitting.
  { id: 'rfq', name: 'RFQ Endpoint', url: '/api/storefront/rfq', method: 'OPTIONS' },
  { id: 'search', name: 'Search API', url: '/api/storefront/products?search=test', method: 'GET' },
]

export function WebsiteHealthMonitor() {
  const [results, setResults] = useState<CheckResult[]>(
    DEFAULT_ENDPOINTS.map(ep => ({
      id: ep.id, name: ep.name, url: ep.url, status: 'unknown',
      responseTime: null, lastChecked: null, statusCode: null,
    }))
  )
  const [checking, setChecking] = useState(false)

  const checkEndpoints = async () => {
    setChecking(true)
    const newResults = await Promise.all(
      DEFAULT_ENDPOINTS.map(async (ep) => {
        const start = performance.now()
        try {
          const baseUrl = window.location.origin
          const response = await fetch(baseUrl + ep.url, {
            method: ep.method,
            signal: AbortSignal.timeout(10000),
          })
          const responseTime = Math.round(performance.now() - start)
          return {
            id: ep.id, name: ep.name, url: ep.url,
            status: response.ok ? 'ok' as const : 'error' as const,
            responseTime, lastChecked: new Date(),
            statusCode: response.status,
          }
        } catch {
          console.warn('[HealthMonitor] Endpoint check failed:', ep.name, ep.url)
          return {
            id: ep.id, name: ep.name, url: ep.url,
            status: 'error' as const,
            responseTime: Math.round(performance.now() - start),
            lastChecked: new Date(),
            statusCode: null,
          }
        }
      })
    )
    setResults(newResults)
    setChecking(false)
  }

  useEffect(() => {
    checkEndpoints()
  }, [])

  const okCount = results.filter(r => r.status === 'ok').length
  const errorCount = results.filter(r => r.status === 'error').length
  const avgResponseTime = results.filter(r => r.responseTime !== null).reduce((s, r) => s + (r.responseTime || 0), 0) /
    Math.max(1, results.filter(r => r.responseTime !== null).length)

  const overallStatus = errorCount === 0 ? 'healthy' : errorCount < results.length / 2 ? 'degraded' : 'down'

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--accent-teal)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Website Health Monitor</h2>
        </div>
        <button onClick={checkEndpoints} disabled={checking}
          className="flex items-center gap-1 rounded-lg bg-[var(--surface-soft)] px-2.5 py-1 text-[0.625rem] font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50">
          <RefreshCw size={10} className={checking ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Overall status */}
      <div className={`flex items-center gap-2 rounded-xl p-3 mb-4 ${
        overallStatus === 'healthy' ? 'bg-[var(--success)]/10 border border-[var(--success)]/20'
        : overallStatus === 'degraded' ? 'bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/20'
        : 'bg-[var(--danger)]/10 border border-[var(--danger)]/20'
      }`}>
        {overallStatus === 'healthy' ? <CheckCircle size={16} className="text-[var(--success)]" /> :
         overallStatus === 'degraded' ? <Clock size={16} className="text-[var(--accent-gold)]" /> :
         <XCircle size={16} className="text-[var(--danger)]" />}
        <div>
          <p className="text-xs font-bold text-[var(--text-primary)] capitalize">{overallStatus}</p>
          <p className="text-[0.625rem] text-[var(--text-muted)]">{okCount}/{results.length} endpoints healthy · Avg {avgResponseTime.toFixed(0)}ms</p>
        </div>
      </div>

      {/* Endpoint list */}
      <div className="space-y-1.5">
        {results.map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {r.status === 'ok' ? <CheckCircle size={12} className="text-[var(--success)] shrink-0" /> :
               r.status === 'error' ? <XCircle size={12} className="text-[var(--danger)] shrink-0" /> :
               r.status === 'checking' ? <RefreshCw size={12} className="text-[var(--text-muted)] shrink-0 animate-spin" /> :
               <Clock size={12} className="text-[var(--text-muted)] shrink-0" />}
              <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{r.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {r.statusCode && (
                <span className={`text-[0.5rem] font-mono font-bold ${
                  r.statusCode < 400 ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                }`}>{r.statusCode}</span>
              )}
              {r.responseTime !== null && (
                <span className={`text-[0.625rem] font-mono font-bold ${
                  r.responseTime < 500 ? 'text-[var(--success)]' : r.responseTime < 2000 ? 'text-[var(--accent-gold)]' : 'text-[var(--danger)]'
                }`}>{r.responseTime}ms</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
