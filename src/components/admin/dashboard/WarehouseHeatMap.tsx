import { useMemo, useState } from 'react'
import { Warehouse, MapPin } from 'lucide-react'
import { relationName } from '../../../lib/orderMetrics'

interface Props {
  products: any[]
}

interface LocationBin {
  id: string
  name: string
  products: number
  stockValue: number
  lowStock: number
  outOfStock: number
  utilization: number
}

export function WarehouseHeatMap({ products }: Props) {
  const [view, setView] = useState<'heatmap' | 'list'>('heatmap')

  const bins = useMemo(() => {
    const locationMap: Record<string, {
      name: string
      products: number
      stockValue: number
      lowStock: number
      outOfStock: number
      totalCapacity: number
    }> = {}

    for (const product of products) {
      const loc = product.warehouseLocation || product.location || product.itemLocation || 'Main Warehouse'
      if (!locationMap[loc]) {
        locationMap[loc] = { name: loc, products: 0, stockValue: 0, lowStock: 0, outOfStock: 0, totalCapacity: 50 }
      }
      const bin = locationMap[loc]
      bin.products++
      bin.stockValue += (Number(product.regularPrice) || 0) * (product.stockCount || 0)
      const stock = product.stockCount || 0
      if (stock === 0 || product.availability === 'out-of-stock') bin.outOfStock++
      else if (stock <= (product.lowStockThreshold ?? 10)) bin.lowStock++
    }

    const bins: LocationBin[] = Object.entries(locationMap)
      .map(([id, data]) => ({
        id,
        name: data.name,
        products: data.products,
        stockValue: data.stockValue,
        lowStock: data.lowStock,
        outOfStock: data.outOfStock,
        utilization: Math.min(100, (data.products / data.totalCapacity) * 100),
      }))
      .sort((a, b) => b.products - a.products)

    // If no warehouse data, create synthetic bins from product categories
    if (bins.length <= 1 && products.length > 0) {
      const categories: Record<string, { products: number; stockValue: number; lowStock: number; outOfStock: number }> = {}
      for (const p of products) {
        const cat = relationName(p.category, 'General')
        if (!categories[cat]) categories[cat] = { products: 0, stockValue: 0, lowStock: 0, outOfStock: 0 }
        categories[cat].products++
        categories[cat].stockValue += (Number(p.regularPrice) || 0) * (p.stockCount || 0)
        const stock = p.stockCount || 0
        if (stock === 0 || p.availability === 'out-of-stock') categories[cat].outOfStock++
        else if (stock <= (p.lowStockThreshold ?? 10)) categories[cat].lowStock++
      }
      return Object.entries(categories)
        .map(([id, data]) => ({
          id, name: id, products: data.products, stockValue: data.stockValue,
          lowStock: data.lowStock, outOfStock: data.outOfStock,
          utilization: Math.min(100, (data.products / 30) * 100),
        }))
        .sort((a, b) => b.products - a.products)
    }

    return bins
  }, [products])

  const totalProducts = bins.reduce((s, b) => s + b.products, 0)
  const totalLowStock = bins.reduce((s, b) => s + b.lowStock, 0)
  const totalOutOfStock = bins.reduce((s, b) => s + b.outOfStock, 0)

  const getHeatColor = (utilization: number) => {
    if (utilization >= 80) return 'bg-[var(--danger)]'
    if (utilization >= 60) return 'bg-[var(--accent-gold)]'
    if (utilization >= 30) return 'bg-[var(--accent-teal)]'
    return 'bg-[var(--accent-blue)]'
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Warehouse size={16} className="text-[var(--accent-blue)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Warehouse Heat Map</h2>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setView('heatmap')}
            className={`rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${view === 'heatmap' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}>Heat Map</button>
          <button onClick={() => setView('list')}
            className={`rounded-lg px-2 py-0.5 text-[0.5rem] font-bold transition-all ${view === 'list' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}>List</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Locations', value: bins.length.toString() },
          { label: 'Total Items', value: totalProducts.toString() },
          { label: 'Low Stock', value: totalLowStock.toString(), color: 'text-[var(--accent-gold)]' },
          { label: 'Out of Stock', value: totalOutOfStock.toString(), color: 'text-[var(--danger)]' },
        ].map(s => (
          <div key={s.label} className="rounded-lg bg-[var(--surface-soft)] p-2 text-center">
            <p className={`font-mono text-sm font-extrabold ${s.color || 'text-[var(--text-primary)]'}`}>{s.value}</p>
            <p className="text-[0.5rem] text-[var(--text-muted)] font-bold uppercase">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-4 text-[0.5rem] text-[var(--text-muted)]">
        <span>Utilization:</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-[var(--accent-blue)]" /> Low</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-[var(--accent-teal)]" /> Medium</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-[var(--accent-gold)]" /> High</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-[var(--danger)]" /> Critical</span>
      </div>

      {view === 'heatmap' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {bins.map(bin => (
            <div key={bin.id} className={`rounded-xl p-3 border ${getHeatColor(bin.utilization)}/10 border-[var(--border)]`}>
              <div className="flex items-center gap-1 mb-2">
                <MapPin size={10} className="text-[var(--text-muted)]" />
                <span className="text-[0.625rem] font-bold text-[var(--text-primary)] truncate">{bin.name}</span>
              </div>
              <p className="font-mono text-lg font-extrabold text-[var(--text-primary)]">{bin.products}</p>
              <p className="text-[0.5rem] text-[var(--text-muted)]">${bin.stockValue.toLocaleString()} value</p>
              <div className="flex items-center gap-2 mt-1">
                {bin.lowStock > 0 && <span className="text-[0.5rem] text-[var(--accent-gold)]">{bin.lowStock} low</span>}
                {bin.outOfStock > 0 && <span className="text-[0.5rem] text-[var(--danger)]">{bin.outOfStock} OOS</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {bins.map(bin => (
            <div key={bin.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-soft)] transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{bin.name}</p>
                <p className="text-[0.625rem] text-[var(--text-muted)]">{bin.products} products · ${bin.stockValue.toLocaleString()}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <div className="flex items-center gap-2">
                  {bin.lowStock > 0 && <span className="text-[0.5rem] text-[var(--accent-gold)]">{bin.lowStock} low</span>}
                  {bin.outOfStock > 0 && <span className="text-[0.5rem] text-[var(--danger)]">{bin.outOfStock} OOS</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
