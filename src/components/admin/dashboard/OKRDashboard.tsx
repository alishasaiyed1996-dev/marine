import { useMemo, useState, useEffect } from 'react'
import { Target, Plus, Trash2, CheckCircle, Circle, Pencil } from 'lucide-react'
import { isCancelledOrRefunded } from './orderStatus'

interface KeyResult {
  id: string
  label: string
  target: number
  current: number
  unit: string
}

interface Objective {
  id: string
  title: string
  keyResults: KeyResult[]
  quarter: string
  createdAt: number
}

interface Props {
  orders: any[]
  products: any[]
  customers: any[]
}

const STORAGE_KEY = 'marine-dashboard-okrs'

function loadOKRs(): Objective[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch { console.warn('[OKR] Failed to load OKRs from localStorage'); return [] }
}

function saveOKRs(okrs: Objective[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(okrs))
}

function createDefaultOKRs(): Objective[] {
  const quarter = `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`
  return [
    {
      id: crypto.randomUUID(),
      title: 'Increase Revenue Growth',
      quarter,
      createdAt: Date.now(),
      keyResults: [
        { id: crypto.randomUUID(), label: 'Total revenue', target: 100000, current: 0, unit: '$' },
        { id: crypto.randomUUID(), label: 'Average order value', target: 500, current: 0, unit: '$' },
        { id: crypto.randomUUID(), label: 'Orders completed', target: 200, current: 0, unit: '' },
      ],
    },
    {
      id: crypto.randomUUID(),
      title: 'Improve Product Catalog',
      quarter,
      createdAt: Date.now(),
      keyResults: [
        { id: crypto.randomUUID(), label: 'Total products', target: 300, current: 0, unit: '' },
        { id: crypto.randomUUID(), label: 'Products in stock', target: 250, current: 0, unit: '' },
        { id: crypto.randomUUID(), label: 'New arrivals', target: 50, current: 0, unit: '' },
      ],
    },
  ]
}

export function OKRDashboard({ orders, products, customers }: Props) {
  const [objectives, setObjectives] = useState<Objective[]>(() => {
    const loaded = loadOKRs()
    return loaded.length > 0 ? loaded : createDefaultOKRs()
  })
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [editingKR, setEditingKR] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Auto-populate current values from data
  const populated = useMemo(() => {
    const totalRevenue = orders.filter((o: any) => !isCancelledOrRefunded(o)).reduce((s: number, o: any) => s + (o.total || 0), 0)
    const completedOrders = orders.filter((o: any) => !isCancelledOrRefunded(o))
    const aov = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0

    return objectives.map(obj => ({
      ...obj,
      keyResults: obj.keyResults.map(kr => {
        if (kr.current > 0) return kr // User has manually set it
        let current = kr.current
        if (kr.label.includes('revenue')) current = totalRevenue
        else if (kr.label.includes('order value')) current = Math.round(aov)
        else if (kr.label.includes('Orders completed') || kr.label.includes('orders')) current = completedOrders.length
        else if (kr.label.includes('products') && !kr.label.includes('stock')) current = products.length
        else if (kr.label.includes('stock')) current = products.filter((p: any) => (p.stockCount || 0) > 0).length
        else if (kr.label.includes('new arrivals')) current = products.filter((p: any) => p.isNewArrival).length
        else if (kr.label.includes('customer')) current = customers.length
        return { ...kr, current }
      }),
    }))
  }, [objectives, orders, products, customers])

  useEffect(() => { saveOKRs(objectives) }, [objectives])

  const handleAdd = () => {
    if (!newTitle.trim()) return
    const quarter = `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`
    setObjectives(prev => [...prev, {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      quarter,
      createdAt: Date.now(),
      keyResults: [
        { id: crypto.randomUUID(), label: 'Key result 1', target: 100, current: 0, unit: '' },
      ],
    }])
    setNewTitle('')
    setShowAdd(false)
  }

  const handleDelete = (id: string) => {
    setObjectives(prev => prev.filter(o => o.id !== id))
  }

  const handleKRUpdate = (objId: string, krId: string, value: string) => {
    const num = parseFloat(value)
    if (isNaN(num)) return
    setObjectives(prev => prev.map(o => o.id === objId ? {
      ...o,
      keyResults: o.keyResults.map(kr => kr.id === krId ? { ...kr, current: num } : kr)
    } : o))
    setEditingKR(null)
  }

  const getOverallProgress = (obj: typeof objectives[0]) => {
    if (obj.keyResults.length === 0) return 0
    const total = obj.keyResults.reduce((s, kr) => {
      const pct = kr.target > 0 ? Math.min(100, (kr.current / kr.target) * 100) : 0
      return s + pct
    }, 0)
    return Math.round(total / obj.keyResults.length)
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">OKR Dashboard</h2>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 rounded-lg bg-[var(--accent-gold)] px-2.5 py-1 text-[0.625rem] font-bold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors">
          <Plus size={10} /> Add Objective
        </button>
      </div>

      {/* Add objective form */}
      {showAdd && (
        <div className="flex gap-2 mb-4 p-3 rounded-xl bg-[var(--surface-soft)]">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="Objective title..."
            className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]  focus:border-[var(--accent-gold)]"
            onKeyDown={e => e.key === 'Enter' && handleAdd()} />
          <button onClick={handleAdd}
            className="rounded-lg bg-[var(--accent-gold)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--btn-blue-text)]">Save</button>
        </div>
      )}

      {populated.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No objectives set. Click "Add Objective" to start.</p>
      ) : (
        <div className="space-y-4">
          {populated.map(obj => {
            const progress = getOverallProgress(obj)
            return (
              <div key={obj.id} className="rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-primary)]">{obj.title}</h3>
                    <p className="text-[0.5rem] text-[var(--text-muted)]">{obj.quarter}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm font-extrabold ${
                      progress >= 70 ? 'text-[var(--success)]' : progress >= 40 ? 'text-[var(--accent-gold)]' : 'text-[var(--danger)]'
                    }`}>{progress}%</span>
                    <button onClick={() => handleDelete(obj.id)} className="p-1 rounded-md hover:bg-[var(--danger)]/10 transition-colors">
                      <Trash2 size={10} className="text-[var(--danger)]" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 rounded-full bg-[var(--surface-soft)] overflow-hidden mb-3">
                  <div className={`h-full rounded-full transition-all ${
                    progress >= 70 ? 'bg-[var(--success)]' : progress >= 40 ? 'bg-[var(--accent-gold)]' : 'bg-[var(--danger)]'
                  }`} style={{ width: `${progress}%` }} />
                </div>

                {/* Key Results */}
                <div className="space-y-2">
                  {obj.keyResults.map(kr => {
                    const pct = kr.target > 0 ? Math.min(100, (kr.current / kr.target) * 100) : 0
                    const isEditing = editingKR === kr.id
                    return (
                      <div key={kr.id} className="flex items-center gap-2">
                        {pct >= 100 ? <CheckCircle size={12} className="text-[var(--success)] shrink-0" /> :
                         <Circle size={12} className="text-[var(--text-muted)] shrink-0" />}
                        <span className="text-[0.625rem] text-[var(--text-secondary)] flex-1 truncate">{kr.label}</span>
                        {isEditing ? (
                          <input type="number" value={editValue} autoFocus
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => handleKRUpdate(obj.id, kr.id, editValue)}
                            onKeyDown={e => e.key === 'Enter' && handleKRUpdate(obj.id, kr.id, editValue)}
                            className="w-16 rounded bg-[var(--surface)] border border-[var(--accent-gold)] px-1.5 py-0.5 text-[0.625rem] text-[var(--text-primary)] font-mono " />
                        ) : (
                          <button onClick={() => { setEditingKR(kr.id); setEditValue(kr.current.toString()) }}
                            className="flex items-center gap-1 hover:bg-[var(--surface-soft)] rounded px-1 py-0.5 transition-colors">
                            <span className="font-mono text-[0.625rem] font-bold text-[var(--text-primary)]">
                              {kr.unit === '$' ? '$' : ''}{kr.current.toLocaleString()}{kr.unit !== '$' && kr.unit ? kr.unit : ''}
                            </span>
                            <Pencil size={8} className="text-[var(--text-muted)]" />
                          </button>
                        )}
                        <span className="text-[0.5rem] text-[var(--text-muted)]">/ {kr.unit === '$' ? '$' : ''}{kr.target.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
