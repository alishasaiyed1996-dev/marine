import { Search, Filter, Download, X, Tag, Package, SearchCheck } from 'lucide-react'

interface AdminProductFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  onPageReset: () => void
  showFilters: boolean
  onToggleFilters: () => void
  activeFilterCount: number
  onExportCsv: () => void
  exporting?: boolean

  // Filter values & setters
  filterCategory: string
  onFilterCategoryChange: (value: string) => void
  filterBrand: string
  onFilterBrandChange: (value: string) => void
  filterCondition: string
  onFilterConditionChange: (value: string) => void
  filterAvailability: string
  onFilterAvailabilityChange: (value: string) => void
  filterStatus: string
  onFilterStatusChange: (value: string) => void
  filterOnSale: boolean
  onFilterOnSaleToggle: () => void
  filterNewArrival: boolean
  onFilterNewArrivalToggle: () => void
  filterSeo: boolean
  onFilterSeoToggle: () => void

  // Dropdown data
  uniqueBrands: string[]
  uniqueCategories: string[]

  // Clear all
  onClearFilters: () => void
}

export function AdminProductFilters({
  search, onSearchChange, onPageReset,
  showFilters, onToggleFilters, activeFilterCount, onExportCsv, exporting,
  filterCategory, onFilterCategoryChange,
  filterBrand, onFilterBrandChange,
  filterCondition, onFilterConditionChange,
  filterAvailability, onFilterAvailabilityChange,
  filterStatus, onFilterStatusChange,
  filterOnSale, onFilterOnSaleToggle,
  filterNewArrival, onFilterNewArrivalToggle,
  filterSeo, onFilterSeoToggle,
  uniqueBrands, uniqueCategories,
  onClearFilters,
}: AdminProductFiltersProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {/* ── Search row ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search by name, SKU, brand, category..."
            value={search}
            onChange={(e) => { onSearchChange(e.target.value); onPageReset() }}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-gold)]"
          />
        </div>
        <button
          onClick={onToggleFilters}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-all ${
            showFilters || activeFilterCount > 0
              ? 'border-[var(--accent-gold)] bg-[var(--gold-muted)] text-[var(--accent-gold)]'
              : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)]'
          }`}
        >
          <Filter size={14} /> Filters
          {activeFilterCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--accent-gold)] px-1.5 text-[0.625rem] font-bold text-[var(--btn-blue-text)]">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={onExportCsv}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] transition-all hover:border-[var(--accent-teal)] hover:text-[var(--accent-teal)] disabled:opacity-50"
        >
          <Download size={14} /> {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* ── Filter dropdowns ── */}
      {showFilters && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3 border-t border-[var(--border)] pt-4">
          <div>
            <label className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => { onFilterStatusChange(e.target.value); onPageReset() }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="hidden">Hidden</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Category</label>
            <select
              value={filterCategory}
              onChange={(e) => { onFilterCategoryChange(e.target.value); onPageReset() }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
            >
              <option value="">All Categories</option>
              {uniqueCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Brand</label>
            <select
              value={filterBrand}
              onChange={(e) => { onFilterBrandChange(e.target.value); onPageReset() }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
            >
              <option value="">All Brands</option>
              {uniqueBrands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Condition</label>
            <select
              value={filterCondition}
              onChange={(e) => { onFilterConditionChange(e.target.value); onPageReset() }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
            >
              <option value="">All Conditions</option>
              <option value="new">New</option><option value="unused">Unused</option><option value="used">Used</option><option value="refurbished">Refurbished</option><option value="reconditioned">Reconditioned</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-[var(--text-muted)]">Availability</label>
            <select
              value={filterAvailability}
              onChange={(e) => { onFilterAvailabilityChange(e.target.value); onPageReset() }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--accent-gold)]"
            >
              <option value="">All</option><option value="in-stock">In Stock</option><option value="emergency">Emergency</option><option value="sourced">Sourced</option><option value="out-of-stock">Out of Stock</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { onFilterOnSaleToggle(); onPageReset() }}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                filterOnSale
                  ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)] text-[var(--btn-blue-text)]'
                  : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)]'
              }`}
            >
              <Tag size={12} className="inline mr-1" /> On Sale
            </button>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { onFilterNewArrivalToggle(); onPageReset() }}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                filterNewArrival
                  ? 'border-[var(--accent-teal)] bg-[var(--accent-teal)] text-[var(--btn-blue-text)]'
                  : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)]'
              }`}
            >
              <Package size={12} className="inline mr-1" /> New Arrivals
            </button>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { onFilterSeoToggle(); onPageReset() }}
              className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                filterSeo
                  ? 'border-[var(--danger)] bg-[var(--danger)] text-[var(--btn-danger-text)]'
                  : 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-secondary)]'
              }`}
              title="Published products missing SEO title/description, verified identifiers, category, or image alt text"
            >
              <SearchCheck size={12} className="inline mr-1" /> Needs SEO
            </button>
          </div>
        </div>
      )}

      {/* ── Active filter chips (when filters panel is hidden) ── */}
      {activeFilterCount > 0 && !showFilters && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[0.625rem] font-bold text-[var(--text-muted)]">Active:</span>
          {filterCategory && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-blue)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-blue)]">
              {filterCategory}
              <button onClick={() => { onFilterCategoryChange(''); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterBrand && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-teal)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-teal)]">
              {filterBrand}
              <button onClick={() => { onFilterBrandChange(''); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterCondition && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-gold)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-gold)]">
              {filterCondition}
              <button onClick={() => { onFilterConditionChange(''); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterAvailability && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--success)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--success)]">
              {filterAvailability}
              <button onClick={() => { onFilterAvailabilityChange(''); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterStatus && (() => {
            const chipStyles: Record<string, string> = {
              published: 'bg-[var(--success)]/10 text-[var(--success)]',
              draft: 'bg-[var(--accent-gold)]/10 text-[var(--accent-gold)]',
              hidden: 'bg-[var(--surface-soft)] text-[var(--text-secondary)]',
              archived: 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]',
            }
            return (
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] font-bold capitalize ${chipStyles[filterStatus] || chipStyles.hidden}`}>
                {filterStatus}
                <button onClick={() => { onFilterStatusChange(''); onPageReset() }}><X size={10} /></button>
              </span>
            )
          })()}
          {filterOnSale && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--danger)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--danger)]">
              On Sale
              <button onClick={() => { onFilterOnSaleToggle(); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterNewArrival && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-teal)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--accent-teal)]">
              New
              <button onClick={() => { onFilterNewArrivalToggle(); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          {filterSeo && (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--danger)]/10 px-2 py-1 text-[0.625rem] font-bold text-[var(--danger)]">
              Needs SEO attention
              <button onClick={() => { onFilterSeoToggle(); onPageReset() }}><X size={10} /></button>
            </span>
          )}
          <button onClick={onClearFilters} className="text-[0.625rem] font-bold text-[var(--danger)] hover:underline ml-1">
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
