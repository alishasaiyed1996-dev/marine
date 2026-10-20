import { useMemo, useState } from 'react'
import { PackageX, Search } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface Props {
  products: any[]
  orders: any[]
}

export function DeadStockAnalyzer({ products, orders }: Props) {
  const [sortBy, setSortBy] = useState<'value' | 'stock' | 'name'>('value')

  const deadStock = useMemo(() => {
    // Collect product IDs that appear in any recent order
    const recentProductIds = new Set<string>()
    for (const order of orders) {
      // Cancelled/refunded orders are not demand; counting them made products
      // that only ever appeared in failed orders look like active sellers.
      if (isCancelledOrRefunded(order)) continue
      for (const item of order.items || []) {
        if (item.productId) recentProductIds.add(item.productId)
      }
    }

    // Dead stock = products with stock but no recent orders
    const dead = products
      .filter(p => (p.stockCount || 0) > 0 && !recentProductIds.has(p.id))
      .map(p => ({
        ...p,
        estimatedValue: (p.regularPrice || 0) * (p.stockCount || 0),
      }))

    // Sort
    if (sortBy === 'value') dead.sort((a, b) => b.estimatedValue - a.estimatedValue)
    else if (sortBy === 'stock') dead.sort((a, b) => (b.stockCount || 0) - (a.stockCount || 0))
    else dead.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

    return dead
  }, [products, orders, sortBy])

  const totalDeadValue = deadStock.reduce((s, p) => s + p.estimatedValue, 0)
  const totalDeadUnits = deadStock.reduce((s, p) => s + (p.stockCount || 0), 0)

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PackageX size={16} className="text-[var(--danger)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Dead Stock Analyzer
          </h2>
        </div>
        <span className="text-[0.625rem] text-[var(--text-muted)] font-medium">
          {deadStock.length} products
        </span>
      </div>

      {/* Summary */}
      <div className="flex gap-4 mb-4">
        <div className="rounded-xl bg-[var(--surface-soft)] px-3 py-2">
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Dead Units</p>
          <p className="font-mono text-sm font-bold text-[var(--text-primary)]">{totalDeadUnits}</p>
        </div>
        <div className="rounded-xl bg-[var(--surface-soft)] px-3 py-2">
          <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">Tied-Up Value</p>
          <p className="font-mono text-sm font-bold text-[var(--danger)]">${totalDeadValue.toLocaleString()}</p>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex gap-1.5 mb-3">
        {(['value', 'stock', 'name'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`rounded-lg px-2.5 py-1 text-[0.625rem] font-bold transition-all ${
              sortBy === s
                ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]'
                : 'bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {s === 'value' ? 'By Value' : s === 'stock' ? 'By Stock' : 'By Name'}
          </button>
        ))}
      </div>

      {/* Product list */}
      {deadStock.length === 0 ? (
        <div className="text-center py-8">
          <Search size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] font-medium">No dead stock found</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {deadStock.slice(0, 20).map(p => (
            <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{p.name}</p>
                <p className="text-[0.625rem] text-[var(--text-muted)]">
                  {p.sku} · {p.brand?.name || p.brand || '—'}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="font-mono text-xs font-bold text-[var(--danger)]">
                  {p.stockCount} units
                </p>
                <p className="font-mono text-[0.625rem] text-[var(--text-muted)]">
                  ${p.estimatedValue.toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
