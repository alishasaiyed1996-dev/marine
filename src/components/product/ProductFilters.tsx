import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, X as XIcon } from 'lucide-react'
import { useOverlayBehavior } from '../../lib/overlay'

interface ProductFiltersProps {
  // Categories
  derivedCategories: { id: string; name: string; count: number }[]
  selectedCategories: string[]
  onToggleCategory: (cat: string) => void
  // Brands
  derivedBrands: { slug: string; name: string }[]
  selectedBrands: string[]
  onToggleBrand: (slug: string) => void
  // Price range
  localMinPrice: string
  localMaxPrice: string
  onMinPriceChange: (v: string) => void
  onMaxPriceChange: (v: string) => void
  onApplyPrice: () => void
  /** Min/max the inputs should allow — seeded from the API's filters.priceRange
   * (the real catalog spread) so high-value items are reachable. */
  priceBounds?: { min: number; max: number }
  // On Sale
  showOnSale: boolean
  onToggleOnSale: () => void
  // Availability
  urgencyFilter: 'all' | 'emergency'
  onSetUrgencyFilter: (v: 'all' | 'emergency') => void
  // Actions
  onClearFilters: () => void
  // Mobile
  showFiltersMobile: boolean
  onToggleMobile: () => void
  // Count
  totalCount: number
}

export function ProductFilters({
  derivedCategories, selectedCategories, onToggleCategory,
  derivedBrands, selectedBrands, onToggleBrand,
  localMinPrice, localMaxPrice, onMinPriceChange, onMaxPriceChange, onApplyPrice,
  priceBounds = { min: 0, max: 10000 },
  showOnSale, onToggleOnSale,
  urgencyFilter, onSetUrgencyFilter,
  onClearFilters,
  showFiltersMobile, onToggleMobile,
  totalCount,
}: ProductFiltersProps) {
  const { t } = useTranslation()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Shared overlay behavior: ref-counted scroll lock, Escape to close, focus
  // trap + restore. Replaces the hand-rolled overflow effect that only covered
  // scroll-lock and never trapped focus or restored it.
  useOverlayBehavior({
    open: showFiltersMobile,
    onClose: () => onToggleMobile(),
    panelRef: sheetRef,
    lockKey: 'filters',
  })

  // The filter panel content — shared between desktop sidebar and mobile sheet
  const filterContent = (
    <div className="p-6">
      {/* Categories */}
      <div className="mb-6">
        <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-3">
          {t('products.category')}
        </span>
        {derivedCategories.map((cat) => (
          <label
            key={cat.id}
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors min-h-[44px] py-2.5"
          >
            <input
              type="checkbox"
              checked={selectedCategories.includes(cat.id)}
              onChange={() => onToggleCategory(cat.id)}
              className="accent-[var(--accent-primary)] w-4 h-4 cursor-pointer"
            />
            <span className="flex-1">{cat.name}</span>
            <span className="text-xs text-[var(--text-muted)]">{cat.count}</span>
          </label>
        ))}
      </div>

      {/* Price Range */}
      <div className="mb-6">
        <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-3">
          {t('products.priceRange')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={priceBounds.min} max={priceBounds.max}
            value={localMinPrice}
            onChange={(e) => onMinPriceChange(e.target.value)}
            onBlur={onApplyPrice}
            onKeyDown={(e) => e.key === 'Enter' && onApplyPrice()}
            placeholder={t('products.priceMin')}
            inputMode="numeric"
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)]"
          />
          <span className="text-[var(--text-muted)] text-xs">—</span>
          <input
            type="number"
            min={priceBounds.min} max={priceBounds.max}
            value={localMaxPrice}
            onChange={(e) => onMaxPriceChange(e.target.value)}
            onBlur={onApplyPrice}
            onKeyDown={(e) => e.key === 'Enter' && onApplyPrice()}
            placeholder={t('products.priceMax')}
            inputMode="numeric"
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)]"
          />
        </div>
        <button
          onClick={onApplyPrice}
          className="w-full mt-2 py-2 text-xs font-bold text-[var(--accent-primary)] hover:text-[var(--accent-gold)] transition-colors bg-transparent border border-[var(--border)] rounded-lg"
        >
          {t('products.applyPrice')}
        </button>
      </div>

      {/* On Sale */}
      <div className="mb-6">
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors min-h-[44px] py-2.5">
          <input
            type="checkbox"
            checked={showOnSale}
            onChange={onToggleOnSale}
            className="accent-[var(--accent-gold)] w-4 h-4 cursor-pointer"
          />
          <span className="font-bold text-[var(--danger)]">{t('products.onSaleOnly')}</span>
        </label>
      </div>

      {/* Brands */}
      <div className="mb-6">
        <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-3">
          {t('products.brand')}
        </span>
        {derivedBrands.map((brand) => (
          <label
            key={brand.slug}
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors min-h-[44px] py-2.5"
          >
            <input
              type="checkbox"
              checked={selectedBrands.includes(brand.slug)}
              onChange={() => onToggleBrand(brand.slug)}
              className="accent-[var(--accent-primary)] w-4 h-4 cursor-pointer"
            />
            {brand.name}
          </label>
        ))}
      </div>

      {/* Availability */}
      <div className="mb-6">
        <span className="inline-block font-body font-medium text-xs tracking-[3px] uppercase text-[var(--text-muted)] mb-3">
          {t('products.availability')}
        </span>
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors min-h-[44px] py-2.5">
          <input
            type="radio"
            name="urgency"
            checked={urgencyFilter === 'all'}
            onChange={() => onSetUrgencyFilter('all')}
            className="accent-[var(--accent-primary)] w-4 h-4 cursor-pointer"
          />
          {t('products.allItems')}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors min-h-[44px] py-2.5">
          <input
            type="radio"
            name="urgency"
            checked={urgencyFilter === 'emergency'}
            onChange={() => onSetUrgencyFilter('emergency')}
            className="accent-[var(--accent-primary)] w-4 h-4 cursor-pointer"
          />
          {t('products.emergencyAvailable')}
        </label>
      </div>

      <button
        onClick={onClearFilters}
        className="w-full text-end text-xs font-bold text-[var(--accent-primary)] hover:text-[var(--accent-gold)] transition-colors bg-transparent border-none cursor-pointer py-2"
      >
        {t('products.clearFilters')}
      </button>
    </div>
  )

  return (
    <>
      {/* Mobile filter toggle button */}
      <div className="lg:hidden flex justify-between items-center mb-2">
        <span className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-widest">
          {totalCount} {totalCount === 1 ? t('products.product') : t('products.products')}
        </span>
        <button
          onClick={onToggleMobile}
          className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg text-xs font-bold border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)]"
        >
          {showFiltersMobile ? <XIcon size={14} /> : <SlidersHorizontal size={14} />}
          {showFiltersMobile ? t('products.hideFilters') : t('products.showFilters')}
        </button>
      </div>

      {/* Desktop sidebar — sticky, inline */}
      <aside className="hidden lg:block lg:sticky lg:top-20">
        <div className="card">
          {filterContent}
        </div>
      </aside>

      {/* Mobile bottom sheet overlay */}
      {showFiltersMobile && (
        <>
          {/* Backdrop — above the sticky navbar (z-50) so taps don't reach
              header actions while the sheet is open */}
          <div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] lg:hidden"
            onClick={onToggleMobile}
            aria-hidden="true"
          />
          {/* Sheet */}
          <div
            ref={sheetRef}
            tabIndex={-1}
            data-modal="filters"
            className="fixed inset-x-0 bottom-0 z-[61] lg:hidden max-h-[85svh] flex flex-col bg-[var(--surface)] border-t border-[var(--border)] rounded-t-2xl shadow-2xl animate-slide-up focus:outline-none"
            role="dialog"
            aria-modal="true"
            aria-label={t('a11y.filters')}
          >
            {/* Drag handle + header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
              {/* Drag handle bar */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-[var(--border)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('products.showFilters')} ({totalCount} {totalCount === 1 ? t('products.product') : t('products.products')})
              </h3>
              <button
                onClick={onToggleMobile}
                className="tap-native flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--border)] transition-colors"
                aria-label={t('a11y.closeFilters')}
              >
                <XIcon size={18} className="text-[var(--text-secondary)]" />
              </button>
            </div>
            {/* Scrollable filter content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {filterContent}
            </div>
            {/* Apply button (sticky at bottom) */}
            <div className="px-5 py-3 border-t border-[var(--border)] shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
              <button
                onClick={onToggleMobile}
                className="w-full py-3 min-h-[44px] bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold text-sm rounded-xl hover:bg-[var(--accent-primary-hover)] transition-colors"
              >
                {t('a11y.showResults')}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
