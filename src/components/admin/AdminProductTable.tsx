import { Link } from 'react-router-dom'
import {
  ArrowUpDown, Eye, EyeOff, Globe, Pencil, Trash2, Package, ImageOff, Tag,
  CheckSquare, Square, X, Loader2, Copy, BadgePercent,
} from 'lucide-react'
import { OptimizedImage } from '../ui/OptimizedImage'
import { AdminPagination } from './AdminPagination'

export type SortKey = 'name' | 'sku' | 'brand' | 'category' | 'price' | 'stock' | 'condition' | 'status'
export type SortDir = 'asc' | 'desc'

interface ProductTableItem {
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

interface AdminProductTableProps {
  products: ProductTableItem[]
  loading: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  onDuplicate: (id: string) => void
  duplicating: string | null
  onOffer: (id: string) => void
  onDeleteRequest: (id: string) => void
  onClearFilters: () => void

  // Inline visibility toggle — publishing straight from the row avoids the
  // select-then-bulk-action detour.
  onTogglePublish: (id: string, status: string) => void
  publishingId: string | null

  // Bulk actions
  onBulkAction: (action: string) => void
  onClearSelection: () => void

  // Pagination
  page: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}

function getBrandName(brand: string | { name: string }): string {
  return typeof brand === 'string' ? brand : brand?.name || 'Unknown'
}

function getCategoryName(category: string | { name: string }): string {
  return typeof category === 'string' ? category : category?.name || 'Unknown'
}

function getConditionBadge(condition: string): string {
  const map: Record<string, string> = {
    new: 'admin-badge-published',
    unused: 'admin-badge-info',
    used: 'admin-badge-draft',
    refurbished: 'admin-badge-draft',
    reconditioned: 'admin-badge-info',
  }
  return map[condition] || 'admin-badge-hidden'
}

function getAvailabilityBadge(availability: string): string {
  const map: Record<string, string> = {
    'in-stock': 'admin-badge-published',
    emergency: 'admin-badge-danger',
    sourced: 'admin-badge-info',
    'out-of-stock': 'admin-badge-danger',
  }
  return map[availability] || 'admin-badge-hidden'
}

function getStatusBadge(status: string): string {
  const map: Record<string, string> = {
    published: 'admin-badge-published',
    draft: 'admin-badge-draft',
    hidden: 'admin-badge-hidden',
    archived: 'admin-badge-info',
  }
  return map[status] || 'admin-badge-hidden'
}

export function AdminProductTable({
  products: paginatedProducts, loading,
  selectedIds, onToggleSelect, onToggleSelectAll,
  onSort,
  onDuplicate, duplicating, onOffer, onDeleteRequest, onClearFilters,
  onTogglePublish, publishingId,
  onBulkAction, onClearSelection,
  page, totalPages, totalItems, onPageChange,
}: AdminProductTableProps) {

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* ── Bulk actions bar ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--gold-muted)] px-4 py-3">
          <span className="text-xs font-bold text-[var(--accent-gold)]">{selectedIds.size} selected</span>
          <div className="flex flex-wrap gap-2 ml-auto">
            <button onClick={() => onBulkAction('publish')} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-teal)]">
              Publish
            </button>
            <button onClick={() => onBulkAction('unpublish')} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-gold)]">
              Hide
            </button>
            <button onClick={() => onBulkAction('mark-offer')} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-blue)]">
              Enable Offers
            </button>
            <button onClick={() => onBulkAction('set-new-arrival')} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-[0.625rem] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-blue)]">
              New Arrival
            </button>
          </div>
          <button onClick={onClearSelection} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-[var(--accent-gold)]" />
          <span className="ml-3 text-sm text-[var(--text-muted)]">Loading products...</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="w-10">
                  <button onClick={onToggleSelectAll} className="flex items-center justify-center">
                    {selectedIds.size === paginatedProducts.length && paginatedProducts.length > 0
                      ? <CheckSquare size={14} className="text-[var(--accent-gold)]" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th><button onClick={() => onSort('name')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Product <ArrowUpDown size={10} /></button></th>
                <th><button onClick={() => onSort('sku')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">SKU <ArrowUpDown size={10} /></button></th>
                <th><button onClick={() => onSort('brand')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Brand <ArrowUpDown size={10} /></button></th>
                <th><button onClick={() => onSort('category')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Category <ArrowUpDown size={10} /></button></th>
                <th><button onClick={() => onSort('price')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Price <ArrowUpDown size={10} /></button></th>
                <th><button onClick={() => onSort('stock')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Stock <ArrowUpDown size={10} /></button></th>
                <th>Condition</th>
                <th><button onClick={() => onSort('status')} className="flex items-center gap-1 hover:text-[var(--text-primary)]">Status <ArrowUpDown size={10} /></button></th>
                <th>Availability</th>
                <th className="w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12">
                    <Package size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
                    <p className="text-sm font-semibold text-[var(--text-muted)]">No products found</p>
                    <button onClick={onClearFilters} className="mt-2 text-xs font-bold text-[var(--accent-gold)] hover:underline">
                      Clear filters
                    </button>
                  </td>
                </tr>
              ) : paginatedProducts.map((product) => {
                const firstValidImage = product.images.find((img) => img.url && !img.url.includes('placeholder'))
                const hasImage = Boolean(firstValidImage)
                const effectivePrice = product.onSale && product.salePrice ? product.salePrice : product.price
                return (
                  <tr key={product.id}>
                    <td>
                      <button onClick={() => onToggleSelect(product.id)} className="flex items-center justify-center">
                        {selectedIds.has(product.id)
                          ? <CheckSquare size={14} className="text-[var(--accent-gold)]" />
                          : <Square size={14} />}
                      </button>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="relative h-10 w-10 shrink-0 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] overflow-hidden flex items-center justify-center">
                          {hasImage ? (
                            <>
                              {/* Rendered behind the thumbnail and revealed only
                                  when the image (plus its fallback chain) fails,
                                  so a broken URL is flagged instead of looking
                                  identical to "no image". */}
                              <ImageOff size={14} className="absolute text-[var(--danger)]" style={{ display: 'none' }} data-broken-indicator />
                              <OptimizedImage
                                src={firstValidImage!.url}
                                alt={firstValidImage!.alt || product.name}
                                width={40}
                                height={40}
                                loading="lazy"
                                className="relative h-full w-full object-cover"
                                onLoad={(e) => {
                                  const el = e.currentTarget
                                  el.style.display = ''
                                  const ind = el.parentElement?.querySelector('[data-broken-indicator]') as HTMLElement | null
                                  if (ind) ind.style.display = 'none'
                                }}
                                onError={(e) => {
                                  const el = e.currentTarget
                                  el.style.display = 'none'
                                  const ind = el.parentElement?.querySelector('[data-broken-indicator]') as HTMLElement | null
                                  if (ind) ind.style.display = 'block'
                                }}
                              />
                            </>
                          ) : (
                            <ImageOff size={14} className="text-[var(--text-muted)]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            to={`/admin/products/${product.id}/edit`}
                            className="text-sm font-bold text-[var(--text-primary)] hover:text-[var(--accent-gold)] no-underline truncate block"
                          >
                            {product.name}
                          </Link>
                          {product.onSale && <span className="inline-flex items-center gap-0.5 text-[0.5625rem] font-bold text-[var(--danger)]"><Tag size={8} /> SALE</span>}
                          {product.isNewArrival && <span className="ml-1 inline-flex items-center gap-0.5 text-[0.5625rem] font-bold text-[var(--success)]">NEW</span>}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{product.sku}</td>
                    <td className="text-xs font-semibold">{getBrandName(product.brand)}</td>
                    <td className="text-xs capitalize">{getCategoryName(product.category).replace(/-/g, ' ')}</td>
                    <td className="font-mono text-xs font-bold">
                      {product.onSale && product.salePrice ? (
                        <>
                          <span className="text-[var(--danger)]">${product.salePrice}</span>
                          <span className="ml-1 line-through text-[var(--text-muted)]">${product.price}</span>
                        </>
                      ) : (
                        <span className="text-[var(--text-primary)]">${effectivePrice}</span>
                      )}
                    </td>
                    <td>
                      <span className={`font-mono text-xs font-bold ${
                        product.stockCount === 0
                          ? 'text-[var(--danger)]'
                          : product.stockCount <= 3
                            ? 'text-[var(--accent-gold)]'
                            : 'text-[var(--text-primary)]'
                      }`}>
                        {product.stockCount}
                      </span>
                    </td>
                    <td><span className={`admin-badge ${getConditionBadge(product.condition)} capitalize`}>{product.condition}</span></td>
                    <td><span className={`admin-badge ${getStatusBadge(product.status)} capitalize`}>{product.status || 'draft'}</span></td>
                    <td><span className={`admin-badge ${getAvailabilityBadge(product.availability)}`}>{product.availability.replace(/-/g, ' ')}</span></td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onTogglePublish(product.id, product.status)}
                          disabled={publishingId === product.id}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:cursor-wait ${
                            product.status === 'published'
                              ? 'text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)]'
                              : 'text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10'
                          }`}
                          title={product.status === 'published' ? 'Unpublish (hide from storefront)' : 'Publish to storefront'}
                        >
                          {publishingId === product.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : product.status === 'published' ? <EyeOff size={12} /> : <Globe size={12} />}
                        </button>
                        <Link
                          to={`/admin/products/${product.id}/edit`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </Link>
                        {product.status === 'published' ? (
                          <a
                            href={`/en/product/${product.id}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
                            title="View on storefront"
                          >
                            <Eye size={12} />
                          </a>
                        ) : (
                          <span
                            className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-lg text-[var(--text-muted)] opacity-40"
                            title="Publish to view on storefront"
                          >
                            <Eye size={12} />
                          </span>
                        )}
                        <button
                          onClick={() => onDuplicate(product.id)}
                          disabled={duplicating === product.id}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-teal)] hover:bg-[var(--accent-teal)]/10 transition-colors"
                          title="Duplicate as draft"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => onOffer(product.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-gold)] hover:bg-[var(--gold-muted)] transition-colors"
                          title="Run offer (sale / make offer)"
                        >
                          <BadgePercent size={12} />
                        </button>
                        <button
                          onClick={() => onDeleteRequest(product.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-danger/5 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        itemLabel="products"
        onPageChange={onPageChange}
      />
    </div>
  )
}
