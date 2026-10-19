import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Award,
  Package,
  Upload,
  X,
  Eye,
  Loader2,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
import { OptimizedImage } from '../../components/ui/OptimizedImage'

interface BrandFormData {
  name: string
  slug: string
  sectors: string[]
  description: string
  seoTitle: string
  seoDescription: string
  website: string
  country: string
  logo: string
}

const logoInputId = 'brand-logo-upload'

const availableSectors = ['Marine', 'Industrial', 'Automation', 'Hydraulic', 'Pneumatic', 'Electrical', 'Power', 'Marine Pumps', 'Navigation', 'Safety']

function getEmptyForm(): BrandFormData {
  return { name: '', slug: '', sectors: [], description: '', seoTitle: '', seoDescription: '', website: '', country: '', logo: '' }
}

interface BrandItem { id: string; name: string; slug: string; sectors: string[]; logo: string; description: string; website: string; country: string; productCount?: number }

export default function AdminBrands() {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingBrand, setEditingBrand] = useState<string | null>(null)
  const [form, setForm] = useState<BrandFormData>(getEmptyForm())
  const [loading, setLoading] = useState(true)
  const [allBrands, setAllBrands] = useState<BrandItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)

  const fetchBrands = useCallback(async () => {
    setLoading(true)
    try {
      const res = await admin.brands.list()
      const items = (res.brands || []).map((b: any) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        sectors: b.sectors || [],
        logo: b.logoUrl || b.logo || '',
        description: b.description || '',
        seoTitle: b.seoTitle || '', seoDescription: b.seoDescription || '',
        website: b.website || '',
        country: b.country || '',
        productCount: b._count?.products ?? b.productCount ?? 0,
      }))
      setAllBrands(items)
    } catch (err: any) {
      console.error('Failed to load brands:', err)
      toast('Failed to load brands', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchBrands() }, [fetchBrands])

  const filteredBrands = useMemo(() => {
    let result = allBrands
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((b) => b.name.toLowerCase().includes(q) || b.sectors.some((s) => s.toLowerCase().includes(q)))
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [allBrands, search])

  const openAddModal = () => {
    setEditingBrand(null)
    setForm(getEmptyForm())
    setShowModal(true)
  }

  const openEditModal = (brandId: string) => {
    const brand = allBrands.find((b) => b.id === brandId)
    if (!brand) return
    setEditingBrand(brandId)
    setForm({ name: brand.name, slug: brand.slug, sectors: [...brand.sectors], description: brand.description, seoTitle: (brand as any).seoTitle || '', seoDescription: (brand as any).seoDescription || '', website: brand.website, country: brand.country, logo: brand.logo || '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const payload = {
        name: form.name,
        slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sectors: form.sectors,
        description: form.description,
        seoTitle: form.seoTitle, seoDescription: form.seoDescription,
        website: form.website,
        country: form.country,
        logoUrl: form.logo,
      }
      if (editingBrand) {
        await admin.brands.update(editingBrand, payload)
        toast(`Brand "${form.name}" updated`, 'success')
      } else {
        await admin.brands.create(payload)
        toast(`Brand "${form.name}" added`, 'success')
      }
      fetchBrands()
    } catch (err: any) {
      toast(err.message || 'Failed to save brand', 'error')
    }
    setShowModal(false)
  }

  const handleDelete = async (brandId: string) => {
    const name = allBrands.find((b) => b.id === brandId)?.name || 'Brand'
    try {
      await admin.brands.delete(brandId)
      toast(`${name} deleted`, 'success')
      fetchBrands()
    } catch (err: any) {
      toast(err.message || 'Failed to delete brand', 'error')
    }
  }

  const toggleSector = (sector: string) => {
    setForm((prev) => ({ ...prev, sectors: prev.sectors.includes(sector) ? prev.sectors.filter((s) => s !== sector) : [...prev.sectors, sector] }))
  }

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]'
  const labelClass = 'mb-1.5 block text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--text-muted)]'

  return (
    <>
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Brands</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{filteredBrands.length} brands</p>
        </div>
        <button onClick={openAddModal} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 hover:-translate-y-0.5">
          <Plus size={14} /> Add Brand
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input type="text" placeholder="Search brands by name or sector..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredBrands.length === 0 ? (
          <div className="col-span-full text-center py-16">{loading ? <Loader2 size={40} className="mx-auto text-[var(--accent-gold)] animate-spin mb-3" /> : <Award size={40} className="mx-auto text-[var(--text-muted)] mb-3" />}<p className="text-sm font-semibold text-[var(--text-muted)]">{loading ? 'Loading brands...' : 'No brands found'}</p></div>
        ) : filteredBrands.map((brand) => {
          const realCount = brand.productCount || 0
          return (
            <div key={brand.id} className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-all hover:border-[var(--accent-gold)] hover:-translate-y-0.5 hover:shadow-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-soft)] border border-[var(--border)]">
                    {brand.logo ? <OptimizedImage src={brand.logo} alt={brand.name} width={32} height={32} loading="lazy" className="h-8 w-8 object-contain" /> : <span className="font-display text-lg font-extrabold text-[var(--accent-blue)]">{brand.name.slice(0, 2).toUpperCase()}</span>}
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">{brand.name}</h3>
                    <p className="text-[0.625rem] text-[var(--text-muted)] font-mono">{brand.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditModal(brand.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors" title="Edit"><Pencil size={12} /></button>
                  <a href={`/en/brands/${brand.slug}/`} target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors" title="View on storefront"><Eye size={12} /></a>
                  <button onClick={() => setDeleteTarget(brand.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors" title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {brand.sectors.map((sector) => <span key={sector} className="inline-block rounded-md bg-[var(--accent-blue)]/8 px-2 py-0.5 text-[0.5625rem] font-bold text-[var(--accent-blue)]">{sector}</span>)}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
                <div className="flex items-center gap-1.5"><Package size={12} className="text-[var(--text-muted)]" /><span className="text-xs font-bold text-[var(--text-primary)]">{realCount}</span><span className="text-[0.625rem] text-[var(--text-muted)]">products</span></div>
                {brand.logo ? <span className="text-[0.5625rem] font-bold text-[var(--success)] flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />Logo</span> : <span className="text-[0.5625rem] font-bold text-[var(--accent-gold)] flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-gold)]" />No Logo</span>}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)]">{editingBrand ? 'Edit Brand' : 'Add Brand'}</h2>
              <button onClick={() => setShowModal(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-soft)] transition-colors"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className={labelClass}>Brand Logo</label>
                <div className="flex items-center gap-4">
                  <div className="h-20 w-20 shrink-0 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] flex items-center justify-center overflow-hidden">
                    {form.logo ? <OptimizedImage src={form.logo} alt="Logo preview" width={80} height={80} loading="lazy" className="h-full w-full object-contain p-2" /> : <Award size={24} className="text-[var(--text-muted)]" />}
                  </div>
                  <div className="flex-1">
                    <input id={logoInputId} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setLogoUploading(true)
                      try {
                        const { asset } = await admin.media.upload(file)
                        setForm((prev) => ({ ...prev, logo: asset.url }))
                        toast('Logo uploaded', 'success')
                      } catch (err: any) {
                        toast(err.message || 'Upload failed', 'error')
                      } finally {
                        setLogoUploading(false)
                        e.target.value = ''
                      }
                    }} />
                    <button onClick={() => document.getElementById(logoInputId)?.click()} disabled={logoUploading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors disabled:opacity-50">
                      {logoUploading ? <><Loader2 size={12} className="animate-spin" /> Uploading...</> : <><Upload size={12} /> Upload Logo</>}
                    </button>
                    <p className="text-[0.625rem] text-[var(--text-muted)] mt-1.5">PNG, SVG, or WebP · Recommended 200×200px</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelClass}>Brand Name *</label><input type="text" value={form.name} onChange={(e) => { const name = e.target.value; setForm((prev) => ({ ...prev, name, slug: prev.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })) }} placeholder="e.g. ABB" className={inputClass} /></div>
                <div><label className={labelClass}>Slug</label><input type="text" value={form.slug} onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))} placeholder="e.g. abb" className={`${inputClass} font-mono`} /></div>
              </div>
              <div>
                <label className={labelClass}>Sectors</label>
                <div className="flex flex-wrap gap-2">
                  {availableSectors.map((sector) => <button key={sector} onClick={() => toggleSector(sector)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${form.sectors.includes(sector) ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)]/10 text-[var(--accent-teal)]' : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:border-[var(--accent-teal)]'}`}>{sector}</button>)}
                </div>
              </div>
              <div><label className={labelClass}>Description</label><textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Brand description for the storefront..." rows={3} className={`${inputClass} resize-y`} /></div>
              <div><label className={labelClass}>SEO Title</label><input value={form.seoTitle} onChange={(e) => setForm((prev) => ({ ...prev, seoTitle: e.target.value }))} maxLength={70} placeholder="e.g. Alfa Laval Marine Spare Parts" className={inputClass} /></div>
              <div><label className={labelClass}>SEO Description</label><textarea value={form.seoDescription} onChange={(e) => setForm((prev) => ({ ...prev, seoDescription: e.target.value }))} maxLength={160} rows={2} placeholder="Search result description, up to 160 characters" className={`${inputClass} resize-y`} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={labelClass}>Website</label><input type="url" value={form.website} onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))} placeholder="https://..." className={inputClass} /></div>
                <div><label className={labelClass}>Country</label><input type="text" value={form.country} onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))} placeholder="e.g. Switzerland" className={inputClass} /></div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={!form.name.trim()} className="rounded-xl bg-[var(--accent-gold)] px-5 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0">{editingBrand ? 'Save Changes' : 'Add Brand'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    <ConfirmDialog open={!!deleteTarget} title="Delete Brand" message="Are you sure you want to delete this brand? This action cannot be undone." confirmLabel="Delete" danger onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); setDeleteTarget(null) }} onCancel={() => setDeleteTarget(null)} />
    </>
  )
}
