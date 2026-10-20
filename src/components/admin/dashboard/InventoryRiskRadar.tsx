import { useMemo, useState } from 'react'
import { Radar, Package } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function InventoryRiskRadar({ products, orders }: Props) {
  const [view, setView] = useState<'overview' | 'critical' | 'warning' | 'healthy'>('overview')

  const analysis = useMemo(() => {
    const now = Date.now()
    const DAY = 86400000
    const productOrderMap = new Map<string, number>()

    for (const order of orders) {
      if (isCancelledOrRefunded(order)) continue
      for (const item of order.items || []) {
        const pid = item.productId
        if (pid) productOrderMap.set(pid, (productOrderMap.get(pid) || 0) + (item.quantity || 1))
      }
    }

    const risks = products.map((p: any) => {
      const stock = p.stockCount || 0
      const threshold = p.lowStockThreshold ?? 10
      const totalSold = productOrderMap.get(p.id) || 0
      const daysSinceAdded = Math.max(1, (now - new Date(p.createdAt || now).getTime()) / DAY)
      const velocity = totalSold / daysSinceAdded

      let riskLevel: 'critical' | 'warning' | 'healthy' = 'healthy'
      let riskType = 'none'
      let riskScore = 0

      if (stock === 0 || p.availability === 'out-of-stock') {
        riskLevel = 'critical'
        riskType = 'out-of-stock'
        riskScore = 100
      } else if (stock <= threshold) {
        riskLevel = velocity > 0.5 ? 'critical' : 'warning'
        riskType = 'low-stock'
        riskScore = velocity > 0.5 ? 85 : 60
      } else if (stock > threshold * 3 && totalSold === 0) {
        riskLevel = 'warning'
        riskType = 'dead-stock'
        riskScore = 50
      } else if (stock > threshold * 5 && velocity < 0.01) {
        riskLevel = 'warning'
        riskType = 'overstocked'
        riskScore = 40
      }

      return {
        id: p.id, name: p.name, sku: p.sku, stock, threshold,
        totalSold, velocity: Math.round(velocity * 100) / 100,
        riskLevel, riskType, riskScore,
        brand: p.brand?.name || p.brand || '—',
      }
    }).sort((a, b) => b.riskScore - a.riskScore)

    const critical = risks.filter(r => r.riskLevel === 'critical')
    const warnings = risks.filter(r => r.riskLevel === 'warning')
    const healthy = risks.filter(r => r.riskLevel === 'healthy')

    return { risks, critical, warnings, healthy }
  }, [products, orders])

  const filtered = view === 'critical' ? analysis.critical
    : view === 'warning' ? analysis.warnings
    : view === 'healthy' ? analysis.healthy
    : analysis.risks

  const riskConfig = {
    'out-of-stock': { color: 'text-[var(--danger)]', bg: 'bg-[var(--danger)]/10', label: 'Out of Stock' },
    'low-stock': { color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', label: 'Low Stock' },
    'dead-stock': { color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', label: 'Dead Stock' },
    'overstocked': { color: 'text-[var(--text-muted)]', bg: 'bg-[var(--surface-soft)]', label: 'Overstocked' },
    none: { color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', label: 'Healthy' },
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radar size={16} className="text-[var(--danger)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Inventory Risk Radar</h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">{analysis.risks.length} products</span>
      </div>

      {/* Risk summary bars */}
      <div className="flex gap-1 mb-4 h-3 rounded-full overflow-hidden bg-[var(--surface-soft)]">
        {analysis.risks.length > 0 && (
          <>
            <div className="bg-[var(--danger)] rounded-full" style={{ width: `${(analysis.critical.length / analysis.risks.length) * 100}%` }} />
            <div className="bg-[var(--accent-gold)] rounded-full" style={{ width: `${(analysis.warnings.length / analysis.risks.length) * 100}%` }} />
            <div className="bg-[var(--success)] rounded-full" style={{ width: `${(analysis.healthy.length / analysis.risks.length) * 100}%` }} />
          </>
        )}
      </div>

      {/* Summary counts */}
      <div className="flex gap-3 mb-4">
        {[
          { label: 'Critical', count: analysis.critical.length, color: 'text-[var(--danger)]' },
          { label: 'Warning', count: analysis.warnings.length, color: 'text-[var(--accent-gold)]' },
          { label: 'Healthy', count: analysis.healthy.length, color: 'text-[var(--success)]' },
        ].map(s => (
          <button key={s.label} onClick={() => setView(s.label.toLowerCase() as 'overview' | 'critical' | 'warning' | 'healthy')}
            className={`flex-1 rounded-xl p-2 text-center transition-all ${view === s.label.toLowerCase() ? 'ring-2 ring-current/20 bg-[var(--surface-soft)]' : 'bg-[var(--surface-soft)] hover:bg-[var(--border)]'}`}>
            <p className={`font-mono text-lg font-extrabold ${s.color}`}>{s.count}</p>
            <p className="text-[0.5rem] font-bold text-[var(--text-muted)] uppercase">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Product list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <Package size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] font-medium">No {view === 'overview' ? '' : view + ' '}risks found</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {filtered.slice(0, 20).map(r => {
            const cfg = riskConfig[r.riskType as keyof typeof riskConfig] || riskConfig.none
            return (
              <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{r.name}</p>
                  <p className="text-[0.625rem] text-[var(--text-muted)]">{r.sku} · {r.brand} · {r.stock} units</p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                  <p className="text-[0.5rem] text-[var(--text-muted)] mt-0.5">{r.velocity}/day velocity</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
