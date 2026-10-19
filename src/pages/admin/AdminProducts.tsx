import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../components/admin/toast-context'
import { useOptimisticMutation } from '../../hooks/useOptimisticMutation'
import { ConfirmDialog } from '../../components/admin/ConfirmDialog'
import { AdminProductFilters } from '../../components/admin/AdminProductFilters'
import { AdminProductTable } from '../../components/admin/AdminProductTable'
import type { SortKey, SortDir } from '../../components/admin/AdminProductTable'
import { AdminImportModal } from '../../components/admin/AdminImportModal'
import { ProductOfferModal } from '../../components/admin/ProductOfferModal'
import { Plus, Upload } from 'lucide-react'
import Papa from 'papaparse'
import { admin } from '../../lib/api'
import { downloadCsv } from '../../lib/utils'
import type { ApiBrand, ApiCategory, ApiProduct, Pagination } from '../../lib/api-types'

const ITEMS_PER_PAGE = 20

interface AdminProduct {
  id: string
  name: string
  sku: string
  brand: string | { name: string }
  category: string | { name: string }
  price: number
  salePrice?: number | null
  onSale: boolean
  stockCount: number
  condition: string
  availability: string
  status: string
  isNewArrival: boolean
  images: { url: string; alt: string; label?: string }[]
  customLabel?: string
}

function getBrandName(brand: string | { name: string }): string {
  return typeof brand === 'string' ? brand : brand?.name || 'Unknown'
}

function getCategoryName(category: string | { name: string }): string {
  return typeof category === 'string' ? category : category?.name || 'Unknown'
}

export default function AdminProducts() {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [productList, setProductList] = useState<AdminProduct[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Latest-value refs so the optimistic snapshot always captures the current
  // list/pagination even inside the async mutation callback. Synced in an
  // effect (after commit), never during render.
  const productListRef = useRef(productList)
  const paginationRef = useRef(pagination)
  useEffect(() => {
    productListRef.current = productList
    paginationRef.current = pagination
  })

  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [filterCategory, setFilterCategory] = useState(searchParams.get('category') || '')
  const [filterBrand, setFilterBrand] = useState(searchParams.get('brand') || '')
  const [filterCondition, setFilterCondition] = useState(searchParams.get('condition') || '')
  const [filterAvailability, setFilterAvailability] = useState(searchParams.get('availability') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '')
  const [filterOnSale, setFilterOnSale] = useState(searchParams.get('sale') === 'true')
  const [filterNewArrival, setFilterNewArrival] = useState(searchParams.get('new') === 'true')
  const [showFilters, setShowFilters] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1))

  // Load brand/category ID mappings for server-side filtering
  const [brandIdMap, setBrandIdMap] = useState<Map<string, string>>(new Map())
  const [categoryIdMap, setCategoryIdMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    Promise.allSettled([
      admin.brands.list(),
      admin.categories.list(),
    ]).then(([brandsRes, catsRes]) => {
      if (brandsRes.status === 'fulfilled') {
        const val = brandsRes.value as { brands?: ApiBrand[] }
        setBrandIdMap(new Map((val?.brands || []).map((x) => [x.name, x.id])))
      }
      if (catsRes.status === 'fulfilled') {
        const val = catsRes.value as { categories?: ApiCategory[] }
        setCategoryIdMap(new Map((val?.categories || []).map((x) => [x.name, x.id])))
      }
    })
  }, [])

  // Fetch products from API
  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search.trim()) params.search = search.trim()
      if (filterCategory) {
        const catId = categoryIdMap.get(filterCategory)
        if (catId) params.categoryId = catId
        else params.category = filterCategory
      }
      if (filterBrand) {
        const brandId = brandIdMap.get(filterBrand)
        if (brandId) params.brandId = brandId
        else params.brand = filterBrand
      }
      if (filterCondition) params.condition = filterCondition
      if (filterAvailability) params.availability = filterAvailability
      if (filterStatus) params.status = filterStatus
      if (filterOnSale) params.onSale = 'true'
      if (filterNewArrival) params.isNewArrival = 'true'
      params.sort = sortKey
      params.order = sortDir
      params.page = String(page)
      params.limit = String(ITEMS_PER_PAGE)

      const res = await admin.products.list(params)
      setPagination(res.pagination || null)
      setProductList((res.products || []).map((p: {
        id: string; name: string; sku: string; brand?: string | { name: string } | null;
        category?: string | { name: string } | null; regularPrice?: number | null; price?: number | null;
        salePrice?: number | null; onSale?: boolean | null; stockCount?: number | null;
        condition?: string | null; availability?: string | null; status?: string | null;
        isNewArrival?: boolean | null; images?: { url?: string; alt?: string; label?: string }[];
        customLabel?: string | null;
      }) => ({
        id: p.id,
        name: p.name || '',
        sku: p.sku || '',
        brand: p.brand || 'Unknown',
        category: p.category || 'Unknown',
        price: p.regularPrice ?? p.price ?? 0,
        salePrice: p.salePrice ?? null,
        onSale: p.onSale ?? false,
        stockCount: p.stockCount ?? 0,
        condition: p.condition || 'used',
        availability: p.availability || 'in-stock',
        status: p.status || 'draft',
        isNewArrival: p.isNewArrival ?? false,
        images: (p.images || []).map((i) => ({ url: i.url || '', alt: i.alt || i.label || '' })),
        customLabel: p.customLabel || '',
      })))
    } catch (err: unknown) {
      console.error('Failed to load products:', err)
      setPagination(null)
      toast('Failed to load products from API', 'error')
    } finally {
      setLoading(false)
    }
  }, [search, filterCategory, filterBrand, categoryIdMap, brandIdMap, filterCondition, filterAvailability, filterStatus, filterOnSale, filterNewArrival, sortKey, sortDir, page, toast])

  useEffect(() => {
    const timer = setTimeout(() => fetchProducts(), 300)
    return () => clearTimeout(timer)
  }, [fetchProducts])

  // Client-side filtering as fallback / refinement
  const filteredProducts = useMemo(() => {
    let result = [...productList]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || getBrandName(p.brand).toLowerCase().includes(q) || getCategoryName(p.category).toLowerCase().includes(q))
    }
    if (filterCategory) result = result.filter((p) => getCategoryName(p.category) === filterCategory)
    if (filterBrand) result = result.filter((p) => getBrandName(p.brand) === filterBrand)
    if (filterCondition) result = result.filter((p) => p.condition === filterCondition)
    if (filterAvailability) result = result.filter((p) => p.availability === filterAvailability)
    if (filterStatus) result = result.filter((p) => (p.status || 'draft') === filterStatus)
    if (filterOnSale) result = result.filter((p) => p.salePrice != null)
    if (filterNewArrival) result = result.filter((p) => p.isNewArrival)

    // Sorting is authoritative on the server (productQueries.listProducts) so the
    // order is correct across the whole catalog, not just this page. Re-sorting
    // here would only reorder the current page and break that global order.
    return result
  }, [productList, search, filterCategory, filterBrand, filterCondition, filterAvailability, filterStatus, filterOnSale, filterNewArrival])

  const totalPages = pagination?.totalPages || Math.ceil(filteredProducts.length / ITEMS_PER_PAGE)
  const totalItems = pagination?.total ?? filteredProducts.length
  const paginatedProducts = filteredProducts

  const uniqueBrands = useMemo(() => {
    const brandSet = new Set([
      ...Array.from(brandIdMap.keys()),
      ...productList.map((p) => getBrandName(p.brand)),
    ])
    return Array.from(brandSet).sort()
  }, [brandIdMap, productList])

  const uniqueCategories = useMemo(() => {
    const catSet = new Set([
      ...Array.from(categoryIdMap.keys()),
      ...productList.map((p) => getCategoryName(p.category)),
    ])
    return Array.from(catSet).sort()
  }, [categoryIdMap, productList])

  useEffect(() => {
    const params: Record<string, string> = {}
    if (search.trim()) params.q = search.trim()
    if (filterCategory) params.category = filterCategory
    if (filterBrand) params.brand = filterBrand
    if (filterCondition) params.condition = filterCondition
    if (filterAvailability) params.availability = filterAvailability
    if (filterStatus) params.status = filterStatus
    if (filterOnSale) params.sale = 'true'
    if (filterNewArrival) params.new = 'true'
    if (page > 1) params.page = String(page)
    setSearchParams(params, { replace: true })
  }, [search, filterCategory, filterBrand, filterCondition, filterAvailability, filterStatus, filterOnSale, filterNewArrival, page, setSearchParams])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [search, filterCategory, filterBrand, filterCondition, filterAvailability, filterStatus, filterOnSale, filterNewArrival, page])

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedProducts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(paginatedProducts.map((p) => p.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const activeFilterCount = [filterCategory, filterBrand, filterCondition, filterAvailability, filterStatus, filterOnSale, filterNewArrival].filter(Boolean).length

  const clearFilters = () => {
    setFilterCategory(''); setFilterBrand(''); setFilterCondition('')
    setFilterAvailability(''); setFilterStatus(''); setFilterOnSale(false); setFilterNewArrival(false)
    setSearch(''); setPage(1); setSearchParams({})
  }

  const BULK_ACTION_LABELS: Record<string, string> = {
    publish: 'published',
    unpublish: 'hidden',
    archive: 'archived',
    'mark-offer': 'marked for offers',
    'set-new-arrival': 'marked as new arrival',
    'set-featured': 'marked as featured',
    'unset-featured': 'unmarked as featured',
  }

  const handleBulkAction = async (action: string) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    try {
      setBulkPublishErrors([])
      await admin.products.bulk(ids, action)
      const label = BULK_ACTION_LABELS[action] || action
      toast(`${ids.length} product${ids.length > 1 ? 's' : ''} ${label}`, 'success')
      fetchProducts()
    } catch (err: unknown) {
      const details = (err as { details?: { field: string; message: string }[] })?.details
      if (action === 'publish' && Array.isArray(details)) setBulkPublishErrors(details)
      toast(err instanceof Error ? err.message : 'Bulk action failed', 'error')
    }
    setSelectedIds(new Set())
  }

  // Optimistic delete: the row disappears the moment the admin confirms;
  // if the API rejects it, the exact previous list/pagination is restored.
  const { mutate: optimisticDelete, pending: deleting } = useOptimisticMutation<
    string,
    { list: AdminProduct[]; pagination: Pagination | null }
  >({
    mutationFn: (id) => admin.products.delete(id),
    optimistic: (id) => {
      setProductList((prev) => prev.filter((p) => p.id !== id))
      setPagination((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev))
    },
    snapshot: () => ({ list: productListRef.current, pagination: paginationRef.current }),
    restore: ({ list, pagination: prevPagination }) => {
      setProductList(list)
      setPagination(prevPagination)
    },
    onSuccess: () => {
      toast('Product deleted', 'success')
      fetchProducts() // Resync server truth — ordering/pagination may shift.
    },
    onError: (err) => {
      toast(err.message || 'Delete failed', 'error')
    },
  })

  const handleDelete = () => {
    if (!deleteTarget) return
    optimisticDelete(deleteTarget)
    setDeleteTarget(null) // Close the confirm modal immediately.
  }

  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [bulkPublishErrors, setBulkPublishErrors] = useState<{ field: string; message: string }[]>([])
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)
  const [offerProduct, setOfferProduct] = useState<ApiProduct | null>(null)
  const [offerOpen, setOfferOpen] = useState(false)
  const [offerSaving, setOfferSaving] = useState(false)

  const handleDuplicate = async (productId: string) => {
    setDuplicating(productId)
    try {
      await admin.products.duplicate(productId)
      toast('Product duplicated as draft', 'success')
      fetchProducts()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to duplicate product', 'error')
    } finally {
      setDuplicating(null)
    }
  }

  // Publish/unpublish a single product straight from the listing row.
  const handleTogglePublish = async (productId: string, status: string) => {
    const action = status === 'published' ? 'unpublish' : 'publish'
    setPublishingId(productId)
    try {
      await admin.products.bulk([productId], action)
      toast(action === 'publish' ? 'Product published to storefront' : 'Product hidden from storefront', 'success')
      fetchProducts()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to update visibility', 'error')
    } finally {
      setPublishingId(null)
    }
  }

  const handleOpenOffer = async (productId: string) => {
    try {
      const res = await admin.products.get(productId)
      setOfferProduct(res.product)
      setOfferOpen(true)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to load product', 'error')
    }
  }

  const handleSaveOffer = async (data: {
    salePrice: number | null
    saleStartsAt: string | null
    saleEndsAt: string | null
    makeOfferEnabled: boolean
    minimumOfferPrice: number | null
    isFeatured: boolean
    isNewArrival: boolean
    customLabel: string | null
    customLabelColor: string | null
  }) => {
    if (!offerProduct) return
    setOfferSaving(true)
    try {
      await admin.products.update(offerProduct.id, data)
      toast(`Offer applied to ${offerProduct.name}`, 'success')
      setOfferOpen(false)
      setOfferProduct(null)
      fetchProducts()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to apply offer', 'error')
    } finally {
      setOfferSaving(false)
    }
  }

  const handleImportCsv = async (file: File) => {
    setImporting(true)
    setImportResult(null)
    try {
      const result = await new Promise<Papa.ParseResult<any>>((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          transformHeader: (h: string) => h.trim().toLowerCase(),
          complete: (results) => resolve(results),
          error: (err: Error) => reject(err),
        })
      })

      if (result.errors.length > 0) {
        const errMessages = result.errors.map((e) => `Row ${e.row}: ${e.message}`)
        toast(`CSV parse errors: ${errMessages[0]}`, 'error')
        setImportResult({ created: 0, skipped: 0, errors: errMessages })
        return
      }

      if (!result.data || result.data.length === 0) {
        toast('CSV file is empty or has no data rows', 'error')
        return
      }

      const rows = result.data.map((row: Record<string, string>) => {
        const clean: Record<string, any> = {}
        for (const [key, value] of Object.entries(row)) {
          const cleanKey = key.trim().toLowerCase()
          clean[cleanKey] = value
        }
        return clean
      })

      const importResult = await admin.products.importCsv(rows)
      setImportResult(importResult)
      toast(`Imported ${importResult.created} products (${importResult.skipped} skipped)`, 'success')
      fetchProducts()
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  const [exporting, setExporting] = useState(false)

  // Exports the full product dataset from the server (not just the current page).
  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const csv = await admin.products.exportCsv()
      downloadCsv(csv, `products-export-${new Date().toISOString().split('T')[0]}.csv`)
      toast('Products exported to CSV', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-[var(--text-primary)]">Products</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {totalItems} products
            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] transition-all hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)]"
          >
            <Upload size={14} /> Import CSV
          </button>
          <Link
            to="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] no-underline transition-all hover:brightness-95 hover:-translate-y-0.5"
          >
            <Plus size={14} /> Add Product
          </Link>
        </div>
      </div>

      {bulkPublishErrors.length > 0 && (
        <section className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-4" role="alert">
          <h2 className="font-bold text-[var(--danger)]">These products were not published</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
            {bulkPublishErrors.map((item, index) => <li key={`${item.field}-${index}`}><strong>{item.field}</strong>: {item.message}</li>)}
          </ul>
        </section>
      )}

      {/* ── Filters ── */}
      <AdminProductFilters
        search={search}
        onSearchChange={setSearch}
        onPageReset={() => setPage(1)}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
        activeFilterCount={activeFilterCount}
        onExportCsv={handleExportCsv}
        exporting={exporting}
        filterCategory={filterCategory}
        onFilterCategoryChange={setFilterCategory}
        filterBrand={filterBrand}
        onFilterBrandChange={setFilterBrand}
        filterCondition={filterCondition}
        onFilterConditionChange={setFilterCondition}
        filterAvailability={filterAvailability}
        onFilterAvailabilityChange={setFilterAvailability}
        filterStatus={filterStatus}
        onFilterStatusChange={setFilterStatus}
        filterOnSale={filterOnSale}
        onFilterOnSaleToggle={() => setFilterOnSale((v) => !v)}
        filterNewArrival={filterNewArrival}
        onFilterNewArrivalToggle={() => setFilterNewArrival((v) => !v)}
        uniqueBrands={uniqueBrands}
        uniqueCategories={uniqueCategories}
        onClearFilters={clearFilters}
      />

      {/* ── Table (with bulk actions, pagination) ── */}
      <AdminProductTable
        products={paginatedProducts}
        loading={loading}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onDuplicate={handleDuplicate}
        duplicating={duplicating}
        onOffer={handleOpenOffer}
        onTogglePublish={handleTogglePublish}
        publishingId={publishingId}
        onDeleteRequest={setDeleteTarget}
        onClearFilters={clearFilters}
        onBulkAction={handleBulkAction}
        onClearSelection={() => setSelectedIds(new Set())}
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={setPage}
      />
    </div>

    {/* ── Import Modal ── */}
    <AdminImportModal
      open={showImport}
      onClose={() => { setShowImport(false); setImportResult(null) }}
      onImport={handleImportCsv}
      importing={importing}
      importResult={importResult}
    />

    {/* ── Delete Confirm ── */}
    <ConfirmDialog
      open={!!deleteTarget}
      title="Delete Product"
      message="Are you sure you want to delete this product? This action cannot be undone."
      confirmLabel={deleting ? 'Deleting...' : 'Delete'}
      danger
      onConfirm={handleDelete}
      onCancel={() => setDeleteTarget(null)}
    />

    {/* ── Run Offer ── */}
    <ProductOfferModal
      open={offerOpen}
      product={offerProduct}
      saving={offerSaving}
      onClose={() => { setOfferOpen(false); setOfferProduct(null) }}
      onSave={handleSaveOffer}
    />
    </>
  )
}
