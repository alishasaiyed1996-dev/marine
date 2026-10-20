import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Upload,
  Grid3X3,
  List,
  Eye,
  Trash2,
  ImageOff,
  Package,
  Filter,
  X,
  CheckSquare,
  Square,
  Download,
  Info,
  ArrowUpDown,
  Loader2,
} from 'lucide-react'
import { admin } from '../../lib/api'
import { useToast } from '../../components/admin/toast-context'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
import { AdminPagination } from '../../components/admin/AdminPagination'
import { OptimizedImage } from '../../components/ui/OptimizedImage'
import type { ApiMediaAsset } from '../../lib/api-types'

type ViewMode = 'grid' | 'list'
type SortBy = 'name' | 'date' | 'label' | 'size'

interface MediaItem {
  id: string
  url: string
  alt: string
  label: string
  filename: string
  originalName: string
  mimeType: string
  fileSize: number
  width: number | null
  height: number | null
  createdAt: string
}

function mapApiAsset(a: ApiMediaAsset): MediaItem {
  return {
    id: a.id,
    url: a.url || '',
    alt: a.altText || a.filename || '',
    label: a.label || 'Unlabeled',
    filename: a.filename || '',
    originalName: a.originalName || a.filename || '',
    mimeType: a.mimeType || 'image/webp',
    fileSize: a.fileSize || a.size || 0,
    width: a.width || null,
    height: a.height || null,
    createdAt: a.createdAt || new Date().toISOString(),
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const ITEMS_PER_PAGE = 24

export default function AdminMedia() {
  const { toast } = useToast()
  const [mediaList, setMediaList] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filterLabel, setFilterLabel] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewImage, setPreviewImage] = useState<MediaItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const [serverTotal, setServerTotal] = useState(0)
  const [serverTotalSize, setServerTotalSize] = useState(0)
  const [availableLabels, setAvailableLabels] = useState<string[]>([])
  const [fileInputEl, setFileInputEl] = useState<HTMLInputElement | null>(null)
  const [usageMap, setUsageMap] = useState<Map<string, { productId: string; productName: string; productSku: string }[]>>(new Map())

  // Fetch media assets from API
  const fetchMedia = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (filterLabel) params.label = filterLabel
      params.sort = sortBy
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)
      const res = await admin.media.list(params)
      setMediaList((res.assets || []).map(mapApiAsset))
      setServerTotal(res.pagination?.total ?? 0)
      setServerTotalSize(res.totalSize ?? 0)
      setAvailableLabels(res.labels || [])
    } catch (err: unknown) {
      console.error('Failed to load media:', err)
      toast('Failed to load media assets', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, filterLabel, sortBy, page, toast])

  useEffect(() => {
    const timer = setTimeout(() => fetchMedia(), 300)
    return () => clearTimeout(timer)
  }, [fetchMedia])

  // The server applies search/label filters and sorting across the entire
  // library, then returns one page. Do not re-filter or re-sort it here.
  const totalPages = Math.max(1, Math.ceil(serverTotal / ITEMS_PER_PAGE))
  const paginatedMedia = mediaList

  const uniqueLabels = availableLabels
  // Total bytes across the whole library (server aggregate), not just this page.
  const totalSize = serverTotalSize

  // Fetch usage for a specific media asset
  const fetchUsage = useCallback(async (assetId: string) => {
    try {
      const res = await admin.media.usage(assetId)
      const usage = (res.usage || []).map((u) => ({
        productId: u.productId || '',
        productName: u.productName || 'Unknown Product',
        productSku: u.productSku || '',
      }))
      setUsageMap((prev) => new Map(prev).set(assetId, usage))
    } catch (err) {
      console.warn('[AdminMedia] Usage fetch failed (graceful degradation):', err)
    }
  }, [])

  // Upload handler
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    let uploaded = 0
    let failed = 0
    for (let i = 0; i < files.length; i++) {
      try {
        await admin.media.upload(files[i])
        uploaded++
      } catch (err: any) {
        failed++
        console.error('Upload failed:', files[i].name, err)
      }
    }
    setUploading(false)
    if (uploaded > 0) {
      toast(`${uploaded} image${uploaded > 1 ? 's' : ''} uploaded successfully`, 'success')
      fetchMedia()
    }
    if (failed > 0) {
      toast(`${failed} upload${failed > 1 ? 's' : ''} failed`, 'error')
    }
  }

  // Delete handler
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await admin.media.delete(deleteTarget)
      toast('Image deleted', 'success')
      setMediaList((prev) => prev.filter((m) => m.id !== deleteTarget))
      setPreviewImage(null)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    let deleted = 0
    for (const id of ids) {
      try {
        await admin.media.delete(id)
        deleted++
      } catch (err) {
        console.warn('[AdminMedia] Bulk delete failed for', id, ':', err)
      }
    }
    if (deleted > 0) {
      toast(`${deleted} image${deleted > 1 ? 's' : ''} deleted`, 'success')
      fetchMedia()
    }
    setSelectedIds(new Set())
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedMedia.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(paginatedMedia.map((m) => m.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Media Library</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {serverTotal} images · {formatFileSize(totalSize)}
              {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
            </p>
          </div>
          <input type="file" ref={(el) => setFileInputEl(el)} accept="image/jpeg,image/png,image/webp,image/avif" multiple className="hidden" onChange={(e) => handleUpload(e.target.files)} disabled={uploading} />
          <button onClick={() => fileInputEl?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] transition-all hover:brightness-95 hover:-translate-y-0.5 disabled:opacity-50">
            <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Images'}
          </button>
        </div>

        {/* Upload Drop Zone */}
        <div
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${uploading ? 'border-[var(--accent-gold)] bg-[var(--gold-muted)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-gold)] cursor-pointer'}`}
          onClick={() => { if (!uploading) fileInputEl?.click() }}
          onDragOver={(e) => { e.preventDefault(); if (!uploading) e.currentTarget.classList.add('border-[var(--accent-gold)]') }}
          onDragLeave={(e) => e.currentTarget.classList.remove('border-[var(--accent-gold)]')}
          onDrop={async (e) => {
            e.preventDefault()
            e.currentTarget.classList.remove('border-[var(--accent-gold)]')
            const files = e.dataTransfer.files
            if (files?.length) handleUpload(files)
          }}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-3">
              <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
              <span className="text-sm font-semibold text-[var(--text-secondary)]">Uploading images...</span>
            </div>
          ) : (
            <>
              <Upload size={40} className="mx-auto text-[var(--text-muted)] mb-3" />
              <p className="text-sm font-semibold text-[var(--text-secondary)]">Click to upload images</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">JPG, PNG, WebP, AVIF · Max 20MB per file · Auto-optimized to WebP</p>
            </>
          )}
        </div>

        {/* Search + Filters */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input type="text" placeholder="Search images by name, filename, label..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]" />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-[var(--text-muted)]" />
              <select value={filterLabel} onChange={(e) => { setFilterLabel(e.target.value); setPage(1) }} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]">
                <option value="">All Labels</option>
                {uniqueLabels.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown size={14} className="text-[var(--text-muted)]" />
              <select value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortBy); setPage(1) }} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]">
                <option value="date">Newest First</option><option value="name">By Name</option><option value="label">By Label</option><option value="size">By Size</option>
              </select>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
              <button onClick={() => setViewMode('grid')} className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}><Grid3X3 size={14} /></button>
              <button onClick={() => setViewMode('list')} className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${viewMode === 'list' ? 'bg-[var(--accent-gold)] text-[var(--btn-blue-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}><List size={14} /></button>
            </div>
          </div>
          {(filterLabel || search) && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[0.625rem] font-bold text-[var(--text-muted)]">Active:</span>
              {filterLabel && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-blue)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-blue)]">{filterLabel}<button onClick={() => { setFilterLabel(''); setPage(1) }}><X size={10} /></button></span>}
              {search && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-teal)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-teal)]">"{search}"<button onClick={() => { setSearch(''); setPage(1) }}><X size={10} /></button></span>}
            </div>
          )}
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--accent-gold)]/30 bg-[var(--gold-muted)] px-4 py-3">
            <span className="text-xs font-bold text-[var(--accent-gold)]">{selectedIds.size} selected</span>
            <div className="flex flex-wrap gap-2 ml-auto">
              <button onClick={handleBulkDelete} className="rounded-lg bg-danger/5 border border-danger/20 px-3 py-1.5 text-[0.625rem] font-bold text-[var(--admin-badge-danger-text)] hover:bg-danger/10"><Trash2 size={10} className="inline mr-1" />Delete</button>
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
          </div>
        )}

        {/* Grid View */}
        {viewMode === 'grid' && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
                <span className="ml-3 text-sm text-[var(--text-muted)]">Loading media...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3">
                {paginatedMedia.length === 0 ? (
                  <div className="col-span-full text-center py-16"><ImageOff size={40} className="mx-auto text-[var(--text-muted)] mb-3" /><p className="text-sm font-semibold text-[var(--text-muted)]">No images found</p></div>
                ) : paginatedMedia.map((media) => {
                  const isSelected = selectedIds.has(media.id)
                  return (
                    <div key={media.id} className={`group relative rounded-xl border overflow-hidden transition-all cursor-pointer ${isSelected ? 'border-[var(--accent-gold)] ring-2 ring-[var(--accent-gold)]/20' : 'border-[var(--border)] hover:border-[var(--accent-gold)] hover:-translate-y-0.5'}`} onClick={() => { setPreviewImage(media); fetchUsage(media.id) }}>
                      <button onClick={(e) => { e.stopPropagation(); toggleSelect(media.id) }} className="absolute top-2 left-2 z-10">{isSelected ? <CheckSquare size={16} className="text-[var(--accent-gold)] drop-shadow" /> : <Square size={16} className="text-white/70 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />}</button>
                      <div className="aspect-square bg-[var(--surface-soft)] flex items-center justify-center overflow-hidden"><OptimizedImage src={media.url} alt={media.alt} width={400} height={400} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /></div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-6">
                        <p className="text-[0.625rem] font-bold text-white truncate">{media.alt || media.originalName}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="inline-block rounded bg-white/20 px-1.5 py-0.5 text-[0.5rem] font-bold text-white/80">{media.label}</span>
                          <span className="text-[0.5rem] text-white/60">{formatFileSize(media.fileSize)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <AdminPagination page={page} totalPages={totalPages} totalItems={serverTotal} itemLabel="images" onPageChange={setPage} />
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="w-10"><button onClick={toggleSelectAll} className="flex items-center justify-center">{selectedIds.size === paginatedMedia.length && paginatedMedia.length > 0 ? <CheckSquare size={14} className="text-[var(--accent-gold)]" /> : <Square size={14} />}</button></th>
                    <th className="w-16">Image</th>
                    <th>Filename</th>
                    <th>Alt Text</th>
                    <th>Label</th>
                    <th>Size</th>
                    <th>Dimensions</th>
                    <th className="w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="text-center py-12"><Loader2 size={20} className="animate-spin text-[var(--accent-gold)] mx-auto" /></td></tr>
                  ) : paginatedMedia.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12"><ImageOff size={32} className="mx-auto text-[var(--text-muted)] mb-3" /><p className="text-sm font-semibold text-[var(--text-muted)]">No images found</p></td></tr>
                  ) : paginatedMedia.map((media) => {
                    const isSelected = selectedIds.has(media.id)
                    return (
                      <tr key={media.id}>
                        <td><button onClick={() => toggleSelect(media.id)} className="flex items-center justify-center">{isSelected ? <CheckSquare size={14} className="text-[var(--accent-gold)]" /> : <Square size={14} />}</button></td>
                        <td><div className="h-10 w-10 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] overflow-hidden flex items-center justify-center cursor-pointer hover:border-[var(--accent-gold)]" onClick={() => { setPreviewImage(media); fetchUsage(media.id) }}><OptimizedImage src={media.url} alt={media.alt} width={40} height={40} loading="lazy" className="h-full w-full object-cover" /></div></td>
                        <td className="font-mono text-xs truncate max-w-[150px]">{media.originalName}</td>
                        <td className="text-xs text-[var(--text-secondary)] max-w-[150px] truncate">{media.alt}</td>
                        <td><span className="admin-badge admin-badge-info">{media.label}</span></td>
                        <td className="text-xs text-[var(--text-muted)]">{formatFileSize(media.fileSize)}</td>
                        <td className="text-xs text-[var(--text-muted)]">{media.width && media.height ? `${media.width}×${media.height}` : '—'}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setPreviewImage(media); fetchUsage(media.id) }} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"><Eye size={12} /></button>
                            <button onClick={() => setDeleteTarget(media.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <AdminPagination page={page} totalPages={totalPages} totalItems={serverTotal} itemLabel="images" onPageChange={setPage} />
          </div>
        )}

        {/* Preview Modal */}
        {previewImage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
            <div className="relative w-full max-w-2xl mx-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setPreviewImage(null)} className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors"><X size={16} /></button>
              <div className="aspect-video bg-[var(--surface-soft)] flex items-center justify-center"><OptimizedImage src={previewImage.url} alt={previewImage.alt} width={800} height={600} loading="eager" className="h-full w-full object-contain" /></div>
              <div className="p-5 space-y-4">
                <div>
                  <h3 className="font-display text-lg font-bold text-[var(--text-primary)]">{previewImage.alt || previewImage.originalName}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">{previewImage.url}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[{ l: 'Label', v: previewImage.label }, { l: 'Type', v: previewImage.mimeType }, { l: 'Size', v: formatFileSize(previewImage.fileSize) }, { l: 'Dimensions', v: previewImage.width && previewImage.height ? `${previewImage.width}×${previewImage.height}` : 'Unknown' }].map((s) => <div key={s.l} className="rounded-lg bg-[var(--surface-soft)] p-3"><p className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">{s.l}</p><p className="text-sm font-bold text-[var(--text-primary)] mt-1">{s.v}</p></div>)}
                </div>
                {/* Product Usage */}
                {usageMap.has(previewImage.id) && (
                  <div>
                    <p className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Products Using This Image ({(usageMap.get(previewImage.id) || []).length})</p>
                    <div className="space-y-1.5">
                      {(usageMap.get(previewImage.id) || []).length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">Not used by any product</p>
                      ) : (
                        (usageMap.get(previewImage.id) || []).slice(0, 5).map((u) => (
                          <div key={u.productId} className="flex items-center justify-between rounded-lg bg-[var(--surface-soft)] px-3 py-2">
                            <div className="flex items-center gap-2"><Package size={12} className="text-[var(--text-muted)]" /><span className="text-xs font-semibold text-[var(--text-primary)]">{u.productName}</span></div>
                            <span className="font-mono text-[0.625rem] text-[var(--text-muted)]">{u.productSku}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                  <button onClick={() => { const a = document.createElement('a'); a.href = previewImage.url; a.download = previewImage.originalName || 'image'; a.click(); toast('Download started', 'success') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)] transition-colors"><Download size={12} /> Download</button>
                  <button onClick={() => { window.open(previewImage.url, '_blank'); toast('Opened in new tab', 'info') }} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--accent-blue)] transition-colors"><Eye size={12} /> Open Original</button>
                  <button onClick={() => setDeleteTarget(previewImage.id)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs font-bold text-[var(--admin-badge-danger-text)] hover:bg-danger/10 transition-colors"><Trash2 size={12} /> Delete</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Image Guidelines */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-2 mb-3"><Info size={14} className="text-[var(--text-muted)]" /><h2 className="font-display text-sm font-bold text-[var(--text-primary)]">Image Guidelines</h2></div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-[var(--surface-soft)] p-3"><p className="text-xs font-bold text-[var(--text-secondary)]">Main Image</p><p className="text-[0.625rem] text-[var(--text-muted)] mt-1">Square or near-square, minimum 800×800px</p></div>
            <div className="rounded-lg bg-[var(--surface-soft)] p-3"><p className="text-xs font-bold text-[var(--text-secondary)]">Auto-Optimization</p><p className="text-[0.625rem] text-[var(--text-muted)] mt-1">Uploaded images are auto-converted to WebP (85% quality) and resized to max 2000px</p></div>
            <div className="rounded-lg bg-[var(--surface-soft)] p-3"><p className="text-xs font-bold text-[var(--text-secondary)]">Duplicate Detection</p><p className="text-[0.625rem] text-[var(--text-muted)] mt-1">Same file is detected by SHA-256 hash — no duplicate storage</p></div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Image"
        message="Are you sure you want to delete this image? This action cannot be undone."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
