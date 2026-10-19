import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { useStore } from '../store/useStore'
import { storefront } from '../lib/api'
import { useCategories } from '../hooks/useApiQuery'
import { SEO } from '../components/seo/SEO'
import { SearchInput, SearchResultsList } from '../components/search'
import type { SearchResult } from '../components/search'

const pages = [
  { title: 'Home', path: '/' },
  { title: 'Products', path: '/products' },
  { title: 'Industries', path: '/industries' },
  { title: 'Brands', path: '/brands' },
  { title: 'About', path: '/about' },
  { title: 'RFQ', path: '/rfq' },
  { title: 'Contact', path: '/contact' },
  { title: 'Emergency Procurement', path: '/emergency' },
  { title: 'Global Network', path: '/network' },
  { title: 'Market Intelligence', path: '/intelligence' },
]

export default function SearchPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null!)
  const navigate = useNavigate()
  const addRecentSearch = useStore((s) => s.addRecentSearch)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // React Query caches categories — replaces manual useEffect + state
  const { data: categoriesData } = useCategories()

  const productCategories: {id: string; name: string; count: number}[] = useMemo(() => {
    if (categoriesData?.categories?.length) {
      return categoriesData.categories.map((c: any) => ({
        id: c.slug || c.id, name: c.name, count: c._count?.products ?? c.productCount ?? 0,
      }))
    }
    return []
  }, [categoriesData])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const performSearch = useCallback(async (q: string, cats: typeof productCategories) => {
    if (!q.trim()) {
      setResults([])
      return
    }

    // Static results (pages + categories) — always available
    const needle = q.trim().toLowerCase()
    const pageResults: SearchResult[] = pages
      .filter((p) => p.title.toLowerCase().includes(needle))
      .map((p) => ({ id: p.path, type: 'page' as const, title: p.title, description: p.path, path: p.path }))

    const categoryResults: SearchResult[] = cats
      .filter((c) => c.name.toLowerCase().includes(needle))
      .map((c) => ({ id: c.id, type: 'category' as const, title: c.name, description: `${c.count} products`, path: `/products?category=${c.id}` }))

    // Try API search for products and brands
    try {
      setLoading(true)
      const res = await storefront.search(q)
      const apiResults: SearchResult[] = []

      if (res.results) {
        for (const r of res.results) {
          if (r.type === 'product') {
            apiResults.push({
              id: r.id,
              type: 'product',
              title: r.name || r.title || '',
              description: r.brand ? `${r.brand} · ${r.sku || ''}` : (r.sku || r.description || ''),
              path: `/product/${r.slug || r.id}`,
            })
          } else if (r.type === 'brand') {
            apiResults.push({
              id: r.id,
              type: 'brand',
              title: r.name || r.title || '',
              description: `${r.productCount ?? 0} products`,
              path: `/products?brand=${r.slug || r.id}`,
            })
          }
        }
      }

      setResults([...apiResults.slice(0, 5), ...pageResults, ...categoryResults])
    } catch {
      console.warn('[Search] API search unavailable — falling back to static results')
      setResults([...pageResults, ...categoryResults])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    setActiveIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => performSearch(value, productCategories), 300)
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const handleSelect = (result: { path: string; title: string }) => {
    if (query.trim()) addRecentSearch(query.trim())
    navigate(result.path)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); handleSelect(results[activeIndex]) }
  }

  return (
    <div className="py-16">
      <SEO
        title="Search — Marine & Industrial Equipment"
        description="Search Alka Traders' catalog of marine spares, industrial equipment, surplus machinery, and hard-to-find parts by name, SKU, brand, or category."
        canonical="/search"
        noindex
      />
      <div className="max-w-[720px] mx-auto px-4 sm:px-6">
        <h1 className="font-display font-bold text-section-lg tracking-tight mb-2">{t('search.title')}</h1>
        <p className="text-body-sm text-[var(--text-secondary)] mb-8">
          {t('search.description')} <kbd className="hidden sm:inline px-1.5 py-0.5 bg-[var(--surface)] border border-[var(--border)] font-mono text-xs">Ctrl+K</kbd> to open from anywhere.
        </p>
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          loading={loading}
          className="mb-8"
        />

        <SearchResultsList
          results={results}
          activeIndex={activeIndex}
          onSelect={handleSelect}
          maxHeight="none"
          getTypeLabel={(type) => t('search.' + type + 's')}
        />

        {query && results.length === 0 && !loading && (
          <div className="text-center py-16">
            <p className="text-sm text-[var(--text-muted)]">{t('search.noResults')} &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {!query && (
          <div className="text-center py-16">
            <SearchIcon size={48} className="mx-auto text-[var(--border)] mb-4" />
            <p className="text-sm text-[var(--text-muted)]">{t('search.typeToSearch')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
