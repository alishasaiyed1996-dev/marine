import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Factory,
  Package,
  X,
  Eye,
  AlertTriangle,
  GripVertical,
  Ship,
  Anchor,
  Flame,
  Zap,
  FlaskConical,
  Cog,
  Wrench,
  Shield,
  Globe,
  Truck,
  Droplet,
  Wind,
  Settings,
  BarChart3,
  Database,
  Loader2,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'

interface IndustryFormData {
  name: string
  slug: string
  icon: string
  description: string
  painPoints: string[]
}

const availableIcons = [
  { id: 'Ship', label: 'Ship' },
  { id: 'Anchor', label: 'Anchor' },
  { id: 'Flame', label: 'Flame' },
  { id: 'Zap', label: 'Zap' },
  { id: 'Factory', label: 'Factory' },
  { id: 'FlaskConical', label: 'Flask' },
  { id: 'Cog', label: 'Cog' },
  { id: 'Wrench', label: 'Wrench' },
  { id: 'Shield', label: 'Shield' },
  { id: 'Globe', label: 'Globe' },
  { id: 'Truck', label: 'Truck' },
  { id: 'Droplet', label: 'Droplet' },
  { id: 'Wind', label: 'Wind' },
  { id: 'Settings', label: 'Settings' },
  { id: 'BarChart3', label: 'Chart' },
  { id: 'Database', label: 'Database' },
]

function getEmptyForm(): IndustryFormData {
  return { name: '', slug: '', icon: 'Factory', description: '', painPoints: [''] }
}

interface IndustryItem { id: string; name: string; slug?: string; icon: string; description: string; painPoints: string[]; productCount?: number }

export default function AdminIndustries() {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingIndustry, setEditingIndustry] = useState<string | null>(null)
  const [form, setForm] = useState<IndustryFormData>(getEmptyForm())
  const [loading, setLoading] = useState(true)
  const [allIndustries, setAllIndustries] = useState<IndustryItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const fetchIndustries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.industries.list()
      const items = (res.industries || []).map((ind: any) => ({
        id: ind.id || ind.slug,
        name: ind.name,
        slug: ind.slug,
        icon: ind.icon || 'Factory',
        description: ind.description || '',
        painPoints: ind.painPoints || [],
        productCount: ind._count?.products ?? ind.productCount ?? 0,
      }))
      setAllIndustries(items)
    } catch (err: any) {
      console.error('Failed to load industries:', err)
      toast('Failed to load industries', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchIndustries() }, [fetchIndustries])

  const filteredIndustries = useMemo(() => {
    let result = allIndustries
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((ind) => ind.name.toLowerCase().includes(q) || ind.description.toLowerCase().includes(q))
    }
    return result
  }, [allIndustries, search])

  const openAddModal = () => {
    setEditingIndustry(null)
    setForm(getEmptyForm())
    setShowModal(true)
  }

  const openEditModal = (industryId: string) => {
    const ind = allIndustries.find((i) => i.id === industryId)
    if (!ind) return
    setEditingIndustry(industryId)
    setForm({ name: ind.name, slug: ind.slug || ind.id, icon: ind.icon, description: ind.description, painPoints: [...ind.painPoints] })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        icon: form.icon,
        description: form.description,
        painPoints: form.painPoints,
      }
      if (editingIndustry) {
        await admin.industries.update(editingIndustry, payload)
        toast(`Industry "${form.name}" updated`, 'success')
      } else {
        await admin.industries.create(payload)
        toast(`Industry "${form.name}" added`, 'success')
      }
      fetchIndustries()
      setShowModal(false)
    } catch (err: any) {
      toast(err.message || 'Failed to save industry', 'error')
    }
  }

  const handleDelete = async (industryId: string) => {
    const name = allIndustries.find((ind) => ind.id === industryId)?.name || 'Industry'
    try {
      await admin.industries.delete(industryId)
      toast(`${name} deleted`, 'success')
      fetchIndustries()
    } catch (err: any) {
      toast(err.message || 'Failed to delete industry', 'error')
    }
  }

  const addPainPoint = () => {
    setForm((prev) => ({ ...prev, painPoints: [...prev.painPoints, ''] }))
  }

  const updatePainPoint = (index: number, value: string) => {
    setForm((prev) => {
      const points = [...prev.painPoints]
      points[index] = value
      return { ...prev, painPoints: points }
    })
  }

  const removePainPoint = (index: number) => {
    setForm((prev) => ({
      ...prev,
      painPoints: prev.painPoints.filter((_, i) => i !== index),
    }))
  }

  const inputClass =
    'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'
  const labelClass = 'mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]'

  const lucideIconMap: Record<string, typeof Factory> = {
    Ship, Anchor, Flame, Zap, Factory, FlaskConical, Cog, Wrench,
    Shield, Globe, Truck, Droplet, Wind, Settings, BarChart3, Database,
  }

  const renderIcon = (iconName: string, size = 20) => {
    const LucideIcon = lucideIconMap[iconName]
    if (LucideIcon) return <LucideIcon size={size} className="text-[var(--accent-blue)]" />
    return <Factory size={size} className="text-[var(--text-muted)]" />
  }

  const mainContent = (
    <div className="space-y-5">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">
            Industries
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {filteredIndustries.length} industries
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 hover:-translate-y-0.5"
        >
          <Plus size={14} />
          Add Industry
        </button>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search industries by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]"
          />
        </div>
      </div>

      {/* Industries Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredIndustries.length === 0 ? (
          <div className="col-span-full text-center py-16">
            {loading ? <Loader2 size={40} className="mx-auto text-[var(--accent-gold)] animate-spin mb-3" /> : <Factory size={40} className="mx-auto text-[var(--text-muted)] mb-3" />}
            <p className="text-sm font-semibold text-[var(--text-muted)]">{loading ? 'Loading industries...' : 'No industries found'}</p>
          </div>
        ) : (
          filteredIndustries.map((ind) => {
            const realCount = ind.productCount || 0
            return (
              <div
                key={ind.id}
                className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:border-[var(--accent-gold)] hover:-translate-y-0.5 hover:shadow-lg"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-soft)] border border-[var(--border)]">
                      {renderIcon(ind.icon)}
                    </div>
                    <div>
                      <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                        {ind.name}
                      </h3>
                      <p className="text-[0.625rem] text-[var(--text-muted)] font-mono">{ind.slug || ind.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditModal(ind.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <a
                      href={`/en/industries#${ind.slug || ind.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
                      title="View on storefront"
                    >
                      <Eye size={12} />
                    </a>
                    <button
                      onClick={() => setDeleteTarget(ind.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-3">
                  {ind.description}
                </p>

                {/* Pain Points */}
                {ind.painPoints.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[0.5625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                      Pain Points ({ind.painPoints.length})
                    </p>
                    <div className="space-y-1">
                      {ind.painPoints.slice(0, 2).map((pp, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <AlertTriangle size={10} className="text-[var(--accent-gold)] mt-0.5 shrink-0" />
                          <p className="text-[0.625rem] text-[var(--text-muted)] line-clamp-1">{pp}</p>
                        </div>
                      ))}
                      {ind.painPoints.length > 2 && (
                        <p className="text-[0.5625rem] text-[var(--text-muted)] font-bold">
                          +{ind.painPoints.length - 2} more
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
                  <div className="flex items-center gap-1.5">
                    <Package size={12} className="text-[var(--text-muted)]" />
                    <span className="text-xs font-bold text-[var(--text-primary)]">{realCount}</span>
                    <span className="text-[0.625rem] text-[var(--text-muted)]">products</span>
                  </div>
                  <span className="text-[0.5625rem] font-bold text-[var(--accent-blue)]">
                    {ind.painPoints.length} pain points
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div
            className="relative w-full max-w-lg mx-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">
                {editingIndustry ? 'Edit Industry' : 'Add Industry'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <div className="p-6 space-y-5">
              {/* Name + Slug */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Industry Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Marine Shipping"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Slug / ID</label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="e.g. marine-shipping"
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              {/* Icon Picker */}
              <div>
                <label className={labelClass}>Icon</label>
                <div className="grid grid-cols-8 gap-2">
                  {availableIcons.map((icon) => (
                    <button
                      key={icon.id}
                      onClick={() => setForm((prev) => ({ ...prev, icon: icon.id }))}
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border text-lg transition-all ${
                        form.icon === icon.id
                          ? 'border-[var(--accent-gold)] bg-[var(--gold-muted)] shadow-[0_0_0_2px_rgba(232,170,36,0.2)]'
                          : 'border-[var(--border)] bg-[var(--surface-soft)] hover:border-[var(--accent-gold)]'
                      }`}
                      title={icon.label}
                    >
                      {renderIcon(icon.id, 18)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Industry description for the storefront..."
                  rows={3}
                  className={`${inputClass} resize-y`}
                />
              </div>

              {/* Pain Points */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelClass}>Pain Points</label>
                  <button
                    onClick={addPainPoint}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors"
                  >
                    <Plus size={10} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {form.painPoints.map((point, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <GripVertical size={12} className="text-[var(--text-muted)] shrink-0" />
                      <input
                        type="text"
                        value={point}
                        onChange={(e) => updatePainPoint(i, e.target.value)}
                        placeholder={`Pain point ${i + 1}`}
                        className={`${inputClass} flex-1`}
                      />
                      {form.painPoints.length > 1 && (
                        <button
                          onClick={() => removePainPoint(i)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim()}
                className="rounded-xl bg-[var(--accent-gold)] px-5 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {editingIndustry ? 'Save Changes' : 'Add Industry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
    {mainContent}
    <ConfirmDialog
      open={!!deleteTarget}
      title="Delete Industry"
      message="Are you sure you want to delete this industry? This action cannot be undone."
      confirmLabel="Delete"
      danger
      onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); setDeleteTarget(null) }}
      onCancel={() => setDeleteTarget(null)}
    />
    </>
  )
}
