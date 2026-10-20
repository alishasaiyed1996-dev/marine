import { useState, useEffect, useMemo } from 'react'
import { Target, Plus, X, TrendingUp, Edit3, Check } from 'lucide-react'
import { orderCustomerEmail } from './orderFields'
import { isCancelledOrRefunded } from './orderStatus'

interface Goal {
  id: string
  label: string
  target: number
  category: 'revenue' | 'orders' | 'customers' | 'products'
  createdAt: string
}

interface Props {
  orders: any[]
  products: any[]
}

const GOALS_KEY = 'alka-admin-goals'

const categoryConfig = {
  revenue: { label: 'Revenue', unit: '$', color: 'text-[var(--accent-gold)]', bg: 'bg-[var(--accent-gold)]/10', icon: '💰' },
  orders: { label: 'Orders', unit: '', color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10', icon: '📦' },
  customers: { label: 'Customers', unit: '', color: 'text-[var(--accent-teal)]', bg: 'bg-[var(--accent-teal)]/10', icon: '👥' },
  products: { label: 'Products', unit: '', color: 'text-[var(--success)]', bg: 'bg-[var(--success)]/10', icon: '🏷️' },
}

function loadGoals(): Goal[] {
  try { return JSON.parse(localStorage.getItem(GOALS_KEY) || '[]') } catch { console.warn('[GoalTracker] Failed to parse goals from localStorage'); return [] }
}

function saveGoals(goals: Goal[]) {
  try { localStorage.setItem(GOALS_KEY, JSON.stringify(goals)) } catch { /* quota exceeded, expected */ }
}

export function GoalTracker({ orders, products }: Props) {
  const [goals, setGoals] = useState<Goal[]>(loadGoals)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newCategory, setNewCategory] = useState<Goal['category']>('revenue')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState('')

  useEffect(() => { saveGoals(goals) }, [goals])

  const currentValues = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const monthOrders = orders.filter(o => o.createdAt >= monthStart && !isCancelledOrRefunded(o))
    const monthCustomers = new Set(monthOrders.map(o => orderCustomerEmail(o)).filter(Boolean))

    return {
      revenue: monthOrders.reduce((s, o) => s + (o.total || 0), 0),
      orders: monthOrders.length,
      customers: monthCustomers.size,
      products: products.length,
    }
  }, [orders, products])

  const handleAdd = () => {
    if (!newLabel.trim() || !newTarget || Number(newTarget) <= 0) return
    const goal: Goal = {
      id: Date.now().toString(),
      label: newLabel.trim(),
      target: Number(newTarget),
      category: newCategory,
      createdAt: new Date().toISOString(),
    }
    setGoals(prev => [...prev, goal])
    setNewLabel('')
    setNewTarget('')
    setShowAdd(false)
  }

  const handleRemove = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id))
  }

  const handleEdit = (id: string) => {
    const goal = goals.find(g => g.id === id)
    if (!goal) return
    setEditingId(id)
    setEditTarget(String(goal.target))
  }

  const handleSaveEdit = (id: string) => {
    const target = Number(editTarget)
    if (target <= 0 || isNaN(target)) return
    setGoals(prev => prev.map(g => g.id === id ? { ...g, target } : g))
    setEditingId(null)
  }

  // Add default goals if empty
  const defaultGoals: Goal[] = [
    { id: 'default-revenue', label: 'Monthly Revenue', target: 50000, category: 'revenue', createdAt: new Date().toISOString() },
    { id: 'default-orders', label: 'Monthly Orders', target: 100, category: 'orders', createdAt: new Date().toISOString() },
    { id: 'default-customers', label: 'Monthly New Customers', target: 50, category: 'customers', createdAt: new Date().toISOString() },
  ]

  const displayGoals = goals.length > 0 ? goals : defaultGoals

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-[var(--accent-gold)]" />
          <h2 className="font-display text-sm font-bold text-[var(--text-primary)]">
            Goal Tracker
          </h2>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 rounded-lg bg-[var(--accent-gold)]/10 px-2.5 py-1 text-[0.625rem] font-bold text-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/20 transition-colors"
        >
          <Plus size={12} /> Add Goal
        </button>
      </div>

      {/* Add goal form */}
      {showAdd && (
        <div className="rounded-xl border border-[var(--accent-gold)]/30 bg-[var(--accent-gold)]/5 p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              placeholder="Goal name..."
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as Goal['category'])}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
            >
              <option value="revenue">Revenue ($)</option>
              <option value="orders">Orders</option>
              <option value="customers">Customers</option>
              <option value="products">Products</option>
            </select>
            <input
              type="number"
              placeholder="Target..."
              value={newTarget}
              onChange={e => setNewTarget(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd}
              className="rounded-lg bg-[var(--accent-gold)] px-3 py-1.5 text-xs font-bold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors">
              Save
            </button>
            <button onClick={() => setShowAdd(false)}
              className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Goals list */}
      {displayGoals.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">No goals set. Click "Add Goal" to start tracking.</p>
      ) : (
        <div className="space-y-3">
          {displayGoals.map(goal => {
            const cfg = categoryConfig[goal.category]
            const current = currentValues[goal.category]
            const percentage = goal.target > 0 ? Math.min(Math.round((current / goal.target) * 100), 100) : 0
            const isEditing = editingId === goal.id

            return (
              <div key={goal.id} className="rounded-xl bg-[var(--surface-soft)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{cfg.icon}</span>
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{goal.label}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[0.5rem] font-bold ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <input
                          type="number"
                          value={editTarget}
                          onChange={e => setEditTarget(e.target.value)}
                          className="w-20 rounded border border-[var(--accent-gold)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-primary)]"
                          onKeyDown={e => e.key === 'Enter' && handleSaveEdit(goal.id)}
                          autoFocus
                        />
                        <button onClick={() => handleSaveEdit(goal.id)}
                          className="rounded p-1 text-[var(--success)] hover:bg-[var(--success)]/10">
                          <Check size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleEdit(goal.id)}
                          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]">
                          <Edit3 size={12} />
                        </button>
                        <button onClick={() => handleRemove(goal.id)}
                          className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10">
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-3 w-full rounded-full bg-[var(--border)] overflow-hidden mb-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      percentage >= 100 ? 'bg-[var(--success)]' :
                      percentage >= 70 ? 'bg-[var(--accent-teal)]' :
                      percentage >= 40 ? 'bg-[var(--accent-gold)]' :
                      'bg-[var(--accent-blue)]'
                    }`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between">
                  <span className="text-[0.625rem] text-[var(--text-muted)]">
                    {cfg.unit}{current.toLocaleString()} / {cfg.unit}{goal.target.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    {percentage >= 100 ? (
                      <span className="flex items-center gap-0.5 text-[0.625rem] font-bold text-[var(--success)]">
                        <TrendingUp size={10} /> Goal reached! 🎉
                      </span>
                    ) : (
                      <span className="text-[0.625rem] font-bold text-[var(--text-muted)]">
                        {percentage}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
