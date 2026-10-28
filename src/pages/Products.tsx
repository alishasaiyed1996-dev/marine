import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAddToCart } from '../hooks/useAddToCart'
import { useProductList } from '../hooks/useApiQuery'
import { apiProductsToFrontend } from '../lib/adapters'
import { shuffle } from '../lib/shuffle'
import { ProductFilters } from '../components/product/ProductFilters'
import { ProductGrid } from '../components/product/ProductGrid'
import { ProductPagination } from '../components/product/ProductPagination'
import { CatalogOfflineNotice } from '../components/ui/CatalogOfflineNotice'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import type { Product } from '../types'

const SORT_OPTIONS = ['relevance', 'name-asc', 'name-desc', 'category', 'price-asc', 'price-desc'] as const
type SortOption = (typeof SORT_OPTIONS)[number]

// Every URL query key this page manages — used to strip them all on "Clear all".
const FILTER_PARAMS = ['search', 'category', 'brand', 'industry', 'priceMin', 'priceMax', 'onSale', 'availability', 'sort', 'page'] as const

export default function Products() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const language = useStore((s) => s.language)
  const {
    searchQuery, setSearchQuery,
    selectedCategories, setSelectedCategories,
    selectedBrands, setSelectedBrands,
    selectedIndustry, setSelectedIndustry,
    priceRange, setPriceRange,
    showOnSale, setShowOnSale,
    urgencyFilter, setUrgencyFilter,
    sortBy, setSortBy,
    clearFilters,
  } = useStore()

  const { handleAddToCart, addedIds } = useAddToCart()

  // Server-side pagination: the API filters + paginates the published catalog
  // (limit/page), so it scales past any single-response cap. Multi-selected
  // categories/brands are sent comma-separated and split on the backend.
  const PAGE_SIZE = 24
  // Must match the store's default priceRange so the untouched state means "no filter"
  const DEFAULT_PRICE_MAX = 10000

  // The URL is the source of truth for pagination: ?page=N drives the current
  // page (implicitly 1 when absent), so back/forward and shared deep links
  // restore the exact page. Filter state stays in the store (it drives the
  // sidebar, chips, and the API-down fallback) and is hydrated from the URL.
  const currentPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)

  // Central write helper: updates the URL's query string for filter/page
  // changes so every state is shareable and back/forward walks the filter
  // history. `replace` is reserved for transient states (search typing,
  // out-of-range page normalization) so they don't spam history.
  const writeParams = useCallback((updater: (p: URLSearchParams) => void, replace = false) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      updater(p)
      return p
    }, { replace })
  }, [setSearchParams])

  const queryParams = useMemo<Record<string, string>>(() => {
    const params: Record<string, string> = { limit: String(PAGE_SIZE), page: String(currentPage) }
    if (searchQuery.trim()) params.search = searchQuery.trim()
    if (selectedCategories.length > 0) params.category = selectedCategories.join(',')
    if (selectedBrands.length > 0) params.brand = selectedBrands.join(',')
    if (selectedIndustry) params.industry = selectedIndustry
    // A price range equal to the store default {min: 0, max: 10000} means "no
    // filter" — only send params once a bound actually changes, so the untouched
    // state never excludes the top of the catalog (which can exceed $10k).
    if (priceRange.min > 0 || priceRange.max !== DEFAULT_PRICE_MAX) {
      if (priceRange.min > 0) params.priceMin = String(priceRange.min)
      if (priceRange.max !== DEFAULT_PRICE_MAX) params.priceMax = String(priceRange.max)
    }
    if (showOnSale) params.onSale = 'true'
    if (urgencyFilter === 'emergency') params.availability = 'emergency'
    if (sortBy !== 'relevance') params.sort = sortBy
    return params
  }, [currentPage, searchQuery, selectedCategories, selectedBrands, selectedIndustry, priceRange, showOnSale, urgencyFilter, sortBy])

  // React Query caches each filter/page combination; keepPreviousData keeps the
  // previous results visible while the next set loads.
  const { data: productListData, isLoading, isError, refetch } = useProductList(queryParams)
  const apiOk = !!productListData

  const apiProducts: Product[] = useMemo(
    () => (productListData?.products?.length ? apiProductsToFrontend(productListData.products) : []),
    [productListData],
  )
  // Rotate the listing on each load so repeat visits surface different stock
  // first (a store with 1,000 rows keeps page 1 fresh). This never changes the
  // result SET — filtering, pagination and explicit sorts are all decided by
  // the API before this runs; shuffling is skipped entirely when the buyer
  // picked a named/price sort. Memoized on the data identity, so React Query's
  // structural sharing keeps an unchanged result in a stable order (cards
  // don't jump mid-browse; a page/filter/reload reshuffles).
  const rotatedProducts = useMemo(
    () => (sortBy === 'relevance' ? shuffle(apiProducts) : apiProducts),
    [apiProducts, sortBy],
  )
  const serverTotal = productListData?.pagination?.total ?? 0
  const serverTotalPages = Math.max(1, productListData?.pagination?.totalPages ?? 1)

  // No demo fallback: if the API fails, the outage notice above explains and
  // the grid renders an explicit empty state — the bundled sample catalog is
  // never passed off as real stock.
  const products = apiOk ? rotatedProducts : []
  const initialLoading = isLoading && !productListData
  const finalCount = apiOk ? serverTotal : 0
  const totalPages = serverTotalPages
  const safePage = Math.min(currentPage, totalPages)

  // If the requested page is beyond the last valid page (stale deep link, or a
  // filter that shrank the result set), normalize the URL to the last page.
  // `replace` so the correction doesn't add a history entry. Page 1 is omitted
  // (delete) to keep the canonical URL clean.
  useEffect(() => {
    if (apiOk && currentPage > serverTotalPages) {
      writeParams((p) => {
        if (serverTotalPages > 1) p.set('page', String(serverTotalPages))
        else p.delete('page')
      }, true)
    }
  }, [apiOk, currentPage, serverTotalPages, writeParams])

  useEffect(() => {
    const el = document.querySelector('main')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [currentPage])

  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [localMinPrice, setLocalMinPrice] = useState(priceRange.min.toString())
  const [localMaxPrice, setLocalMaxPrice] = useState(priceRange.max.toString())
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocalSearch(searchQuery) }, [searchQuery])

  const debouncedSetSearch = useCallback((value: string) => {
    setLocalSearch(value)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const trimmed = value.trim()
    debounceTimerRef.current = setTimeout(() => {
      setSearchQuery(trimmed)
      // replace: live typing shouldn't create a history entry per keystroke
      writeParams((p) => {
        if (trimmed) p.set('search', trimmed)
        else p.delete('search')
        p.delete('page')
      }, true)
    }, 300)
  }, [setSearchQuery, setLocalSearch, writeParams])

  useEffect(() => () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }, [])

  // Hydrate the store from the URL whenever it changes — on first load (deep
  // links), on back/forward, and after our own writes. Setters only fire when
  // a value genuinely differs (compare-and-set), so the URL can never fight
  // the state it just produced.
  useEffect(() => {
    const sp = searchParams
    const st = useStore.getState()
    const nextCategories = (sp.get('category') ?? '').split(',').filter(Boolean)
    const nextBrands = (sp.get('brand') ?? '').split(',').filter(Boolean)
    const nextSearch = sp.get('search') ?? ''
    const nextIndustry = sp.get('industry') ?? ''
    const nextMin = Math.max(0, parseInt(sp.get('priceMin') ?? '0', 10) || 0)
    const nextMax = Math.max(nextMin + 1, parseInt(sp.get('priceMax') ?? String(DEFAULT_PRICE_MAX), 10) || DEFAULT_PRICE_MAX)
    const nextOnSale = sp.get('onSale') === 'true'
    const nextUrgency = sp.get('availability') === 'emergency' ? 'emergency' : 'all'
    const rawSort = sp.get('sort') ?? ''
    const nextSort: SortOption = (SORT_OPTIONS as readonly string[]).includes(rawSort) ? (rawSort as SortOption) : 'relevance'

    if (st.selectedCategories.join(',') !== nextCategories.join(',')) setSelectedCategories(nextCategories)
    if (st.selectedBrands.join(',') !== nextBrands.join(',')) setSelectedBrands(nextBrands)
    if (st.searchQuery !== nextSearch) setSearchQuery(nextSearch)
    if (st.selectedIndustry !== nextIndustry) setSelectedIndustry(nextIndustry)
    if (st.priceRange.min !== nextMin || st.priceRange.max !== nextMax) setPriceRange({ min: nextMin, max: nextMax })
    if (st.showOnSale !== nextOnSale) setShowOnSale(nextOnSale)
    if (st.urgencyFilter !== nextUrgency) setUrgencyFilter(nextUrgency)
    if (st.sortBy !== nextSort) setSortBy(nextSort)
  }, [searchParams, setSelectedCategories, setSelectedBrands, setSelectedIndustry, setSearchQuery, setPriceRange, setShowOnSale, setUrgencyFilter, setSortBy])

  // Leaving the page clears the store's filter state so a later visit starts
  // fresh — the URL (which still holds the filters) re-hydrates on next mount.
  useEffect(() => () => { clearFilters() }, [clearFilters])

  useEffect(() => { setLocalMinPrice(priceRange.min.toString()); setLocalMaxPrice(priceRange.max.toString()) }, [priceRange])

  // ── Filter/page handlers: update the store optimistically AND write the URL ──
  const toggleCategory = (cat: string) => {
    const st = useStore.getState()
    const next = st.selectedCategories.includes(cat)
      ? st.selectedCategories.filter((c) => c !== cat)
      : [...st.selectedCategories, cat]
    setSelectedCategories(next)
    writeParams((p) => {
      if (next.length > 0) p.set('category', next.join(','))
      else p.delete('category')
      p.delete('page') // a filter change always resets to page 1
    })
  }
  const toggleBrand = (slug: string) => {
    const st = useStore.getState()
    const next = st.selectedBrands.includes(slug)
      ? st.selectedBrands.filter((b) => b !== slug)
      : [...st.selectedBrands, slug]
    setSelectedBrands(next)
    writeParams((p) => {
      if (next.length > 0) p.set('brand', next.join(','))
      else p.delete('brand')
      p.delete('page')
    })
  }
  const applyPriceFilter = () => {
    const parsedMin = parseInt(localMinPrice, 10)
    const parsedMax = parseInt(localMaxPrice, 10)
    // An empty/invalid max means "no upper bound", not a $0–$1 filter.
    const min = Number.isFinite(parsedMin) ? Math.max(0, parsedMin) : 0
    const max = Number.isFinite(parsedMax) ? Math.max(parsedMax, min + 1) : DEFAULT_PRICE_MAX
    setPriceRange({ min, max })
    writeParams((p) => {
      if (min > 0) p.set('priceMin', String(min))
      else p.delete('priceMin')
      if (max !== DEFAULT_PRICE_MAX) p.set('priceMax', String(max))
      else p.delete('priceMax')
      p.delete('page')
    })
  }
  const handleToggleOnSale = () => {
    const next = !showOnSale
    setShowOnSale(next)
    writeParams((p) => {
      if (next) p.set('onSale', 'true')
      else p.delete('onSale')
      p.delete('page')
    })
  }
  const handleSetUrgency = (next: 'all' | 'emergency') => {
    setUrgencyFilter(next)
    writeParams((p) => {
      if (next === 'emergency') p.set('availability', 'emergency')
      else p.delete('availability')
      p.delete('page')
    })
  }
  const handleSortChange = (value: SortOption) => {
    setSortBy(value)
    writeParams((p) => {
      if (value !== 'relevance') p.set('sort', value)
      else p.delete('sort')
      p.delete('page')
    })
  }
  const handlePageChange = (page: number) => {
    writeParams((p) => p.set('page', String(page)))
  }
  const handleClearFilters = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    clearFilters()
    setLocalSearch('')
    writeParams((p) => {
      for (const key of FILTER_PARAMS) p.delete(key)
    })
  }

  // Sidebar options come from the API's `filters` payload — full-catalog counts
  // and authoritative slugs (also fixes brand slugs that were previously derived
  // from display names, e.g. "Bosch Rexroth" → boschrexroth vs the real
  // bosch-rexroth). No static-catalog fallback: an empty sidebar is honest,
  // fake category/brand counts are not.
  const apiFilters = productListData?.filters

  // Price input bounds: the API's filters.priceRange reflects the real catalog
  // spread (e.g. $85–$12,000 — not the old hard-coded $1,000 cap). Until it
  // arrives, fall back to the page's default range, not to demo-product prices.
  const priceBounds = apiFilters?.priceRange ?? { min: 0, max: DEFAULT_PRICE_MAX }

  const derivedCategories = useMemo(
    () => apiFilters?.categories ?? [],
    [apiFilters],
  )

  const derivedBrands = useMemo(
    () => (apiFilters?.brands ?? []).map((b) => ({ slug: b.id, name: b.name })),
    [apiFilters],
  )

  // Active filter chips
  const hasActiveFilters = searchQuery || selectedCategories.length > 0 || selectedBrands.length > 0 || showOnSale || urgencyFilter === 'emergency'
  const seoQueryLabel = searchQuery || selectedCategories[0]?.replace(/-/g, ' ') || selectedBrands[0] || ''
  const canonicalQuery = searchParams.get('category')
    ? `/${language}/products?category=${encodeURIComponent(searchParams.get('category') || '')}`
    : searchParams.get('brand')
      ? `/${language}/products?brand=${encodeURIComponent(searchParams.get('brand') || '')}`
      : searchParams.get('search')
        ? `/${language}/products?search=${encodeURIComponent(searchParams.get('search') || '')}`
        : `/${language}/products`
  // B18 faceted-navigation rule: a single facet (category OR brand OR search)
  // keeps its own canonical (above); COMBINATIONS and paginated views are
  // thin near-duplicates — noindex,follow so crawlers keep the canonical set
  // tight. (Internal links remain followable; nothing is blocked in robots.)
  const activeFacets = [
    searchParams.get('category') ? 1 : 0,
    searchParams.get('brand') ? 1 : 0,
    searchParams.get('search') ? 1 : 0,
    searchParams.get('industry') ? 1 : 0,
    searchParams.get('priceMin') || searchParams.get('priceMax') ? 1 : 0,
    searchParams.get('onSale') ? 1 : 0,
    searchParams.get('availability') ? 1 : 0,
  ].reduce<number>((a, b) => a + b, 0)
  const hasJunkFilters = activeFacets > 1 || currentPage > 1
  const productsSeoTitle = seoQueryLabel
    ? `${seoQueryLabel} Marine Spare Parts & Ship Spares`
    : 'Marine Spare Parts & Ship Spares Catalog'
  const productsSeoDescription = seoQueryLabel
    ? `Browse ${seoQueryLabel} marine spare parts, ship spares, industrial MRO equipment, hydraulic, electrical, pump, safety, and surplus stock from Alka Traders.`
    : 'Browse marine spare parts, ship spares, marine engine parts, hydraulic pumps, electrical automation, navigation equipment, safety gear, rigging, and industrial surplus stock.'
  const productItemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: productsSeoTitle,
    description: productsSeoDescription,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: Math.min(products.length, 24),
      itemListElement: products.slice(0, 24).map((product, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `https://alkatraders.co/en/product/${product.slug || product.id}/`,
        name: product.name,
      })),
    },
  }

  return (
    <div>
      <SEO
        title={productsSeoTitle}
        description={productsSeoDescription.slice(0, 158)}
        canonical={canonicalQuery}
        noindex={hasJunkFilters}
        jsonLd={hasJunkFilters ? [] : [productItemListJsonLd]}
      />
      <BreadcrumbJsonLd items={[{ name: 'Home', url: '/' }, { name: 'Products', url: '/products' }]} />
      {/* Header */}
      <section className="bg-[var(--secondary-bg)] py-16 border-b border-[var(--border)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 text-center">
          <span className="inline-block font-body font-bold text-xs tracking-[3px] uppercase text-[var(--accent-primary)] mb-4">
            {t('products.catalog')}
          </span>
          <h1 className="font-display font-bold text-display-xl tracking-tight">
            {t('products.title')}
          </h1>
          <p className="max-w-[680px] mx-auto mt-4 text-body text-[var(--text-secondary)]">
            {t('products.description')}
          </p>
          <div className="relative max-w-[640px] mx-auto mt-8">
            <Search size={16} className="absolute start-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              value={localSearch}
              onChange={(e) => debouncedSetSearch(e.target.value)}
              placeholder={t('products.searchPlaceholder')}
              autoComplete="off"
              className="w-full ps-11 pe-4 py-4 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] transition-all"
            />
          </div>
        </div>
      </section>

      {/* Layout */}
      <section className="py-12 bg-[var(--primary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8 items-start">
            {/* Sidebar Filters */}
            <ProductFilters
              derivedCategories={derivedCategories}
              selectedCategories={selectedCategories}
              onToggleCategory={toggleCategory}
              derivedBrands={derivedBrands}
              selectedBrands={selectedBrands}
              onToggleBrand={toggleBrand}
              localMinPrice={localMinPrice}
              localMaxPrice={localMaxPrice}
              onMinPriceChange={setLocalMinPrice}
              onMaxPriceChange={setLocalMaxPrice}
              onApplyPrice={applyPriceFilter}
              priceBounds={priceBounds}
              showOnSale={showOnSale}
              onToggleOnSale={handleToggleOnSale}
              urgencyFilter={urgencyFilter}
              onSetUrgencyFilter={handleSetUrgency}
              onClearFilters={handleClearFilters}
              showFiltersMobile={showFiltersMobile}
              onToggleMobile={() => setShowFiltersMobile((v) => !v)}
              totalCount={finalCount}
            />

            {/* Main content */}
            <div>
              {/* Outage must be visible: without this the page silently
                  serves the bundled demo catalog instead of real stock. */}
              {isError && (
                <CatalogOfflineNotice
                  className="mb-4"
                  onRetry={() => { refetch() }}
                  retrying={isLoading}
                />
              )}
              {/* Active filter chips */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {searchQuery && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 text-[var(--accent-primary)]">
                      Search: "{searchQuery}"
                      <button onClick={() => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); setSearchQuery(''); setLocalSearch(''); writeParams((p) => { p.delete('search'); p.delete('page') }) }} aria-label={t('a11y.removeFilter')} className="tap-native tap-pad flex h-8 w-8 items-center justify-center me-0.5 hover:text-[var(--danger)] transition-colors cursor-pointer bg-transparent border-none text-inherit font-bold">×</button>
                    </span>
                  )}
                  {selectedCategories.map((catId) => {
                    const cat = derivedCategories.find((c) => c.id === catId)
                    return (
                      <span key={catId} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--accent-gold)] bg-[var(--accent-gold)]/5 text-[var(--accent-gold)]">
                        {cat?.name ?? catId}
                        <button onClick={() => toggleCategory(catId)} aria-label={t('a11y.removeFilter')} className="tap-native tap-pad flex h-8 w-8 items-center justify-center me-0.5 hover:text-[var(--danger)] transition-colors cursor-pointer bg-transparent border-none text-inherit font-bold">×</button>
                      </span>
                    )
                  })}
                  {selectedBrands.map((slug) => {
                    const brand = derivedBrands.find((b) => b.slug === slug)
                    return (
                      <span key={slug} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 text-[var(--accent-primary)]">
                        {brand?.name ?? slug}
                        <button onClick={() => toggleBrand(slug)} aria-label={t('a11y.removeFilter')} className="tap-native tap-pad flex h-8 w-8 items-center justify-center me-0.5 hover:text-[var(--danger)] transition-colors cursor-pointer bg-transparent border-none text-inherit font-bold">×</button>
                      </span>
                    )
                  })}
                  {showOnSale && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--danger)] bg-[var(--danger)]/5 text-[var(--danger)]">
                      On Sale
                      <button onClick={handleToggleOnSale} aria-label={t('a11y.removeFilter')} className="tap-native tap-pad flex h-8 w-8 items-center justify-center me-0.5 hover:text-[var(--danger)] transition-colors cursor-pointer bg-transparent border-none text-inherit font-bold">×</button>
                    </span>
                  )}
                  {urgencyFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--accent-gold)]/30 bg-[var(--accent-gold)]/5 text-[var(--accent-gold)]">
                      Emergency Available
                      <button onClick={() => handleSetUrgency('all')} aria-label={t('a11y.removeFilter')} className="tap-native tap-pad flex h-8 w-8 items-center justify-center me-0.5 hover:text-[var(--danger)] transition-colors cursor-pointer bg-transparent border-none text-inherit font-bold">×</button>
                    </span>
                  )}
                  <button onClick={handleClearFilters} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)] transition-colors cursor-pointer">
                    Clear all
                  </button>
                </div>
              )}
              <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
                <span className="text-sm text-[var(--text-secondary)]">
                  {t('products.showing')} {finalCount} {finalCount === 1 ? t('products.product') : t('products.products')}
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SortOption)}
                  aria-label={t('products.sort')}
                  className="select-chevron px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] cursor-pointer"
                >
                  <option value="relevance">{t('products.sort')}: {t('products.sortRelevance')}</option>
                  <option value="name-asc">{t('products.sort')}: {t('products.sortNameAsc')}</option>
                  <option value="name-desc">{t('products.sort')}: {t('products.sortNameDesc')}</option>
                  <option value="category">{t('products.sort')}: {t('products.sortCategory')}</option>
                  <option value="price-asc">{t('products.sort')}: {t('products.sortPriceAsc')}</option>
                  <option value="price-desc">{t('products.sort')}: {t('products.sortPriceDesc')}</option>
                </select>
              </div>

              {initialLoading ? (
                <ProductGrid products={[]} addedIds={addedIds} onAddToCart={handleAddToCart} isLoading />
              ) : isError && !productListData ? (
                // Outage: the notice at the top explains why — never show demo
                // products, and don't dress this up as "no results" either.
                <div className="text-center py-20">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t('catalog.offlineTitle')}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-2">{t('catalog.offlineBody')}</p>
                  <button onClick={() => refetch()} className="mt-4 text-xs font-bold text-[var(--accent-primary)] hover:text-[var(--accent-gold)] bg-transparent border border-[var(--border)] px-4 py-2 rounded-lg cursor-pointer">
                    {t('catalog.retry')}
                  </button>
                </div>
              ) : finalCount === 0 ? (
                <div className="text-center py-20">
                  <p className="text-sm text-[var(--text-muted)]">{t('products.noResults')}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-2">Try removing some filters or search with different keywords.</p>
                  <button onClick={handleClearFilters} className="mt-4 text-xs font-bold text-[var(--accent-primary)] hover:text-[var(--accent-gold)] bg-transparent border border-[var(--border)] px-4 py-2 rounded-lg cursor-pointer">
                    {t('products.clearFilters')}
                  </button>
                </div>
              ) : products.length === 0 ? (
                // Transient: the fetch for this page returned nothing yet (e.g. the
                // clamp effect is snapping an out-of-range page back to a valid one)
                <ProductGrid products={[]} addedIds={addedIds} onAddToCart={handleAddToCart} isLoading />
              ) : (
                <>
                  <ProductGrid products={products} addedIds={addedIds} onAddToCart={handleAddToCart} />
                  <ProductPagination currentPage={safePage} totalPages={totalPages} onPageChange={handlePageChange} />
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
