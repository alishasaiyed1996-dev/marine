import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { storefront } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { apiProductsToFrontend } from '../../lib/adapters'
import { SearchInput, SearchResultsList } from '../search'
import type { SearchResult } from '../search'
import type { Product } from '../../types'

const pages = [
  { title: 'Home', path: '/' },
  { title: 'Products', path: '/products' },
  { title: 'Industries', path: '/industries' },
  { title: 'Brands', path: '/brands' },
  { title: 'About', path: '/about' },
  { title: 'RFQ', path: '/rfq' },
  { title: 'Contact', path: '/contact' },
  { title: 'Emergency Procurement', path: '/emergency' },
  { title: 'Network', path: '/network' },
  { title: 'Intelligence', path: '/intelligence' },
]

export function CommandSearch() {
  const { t } = useTranslation()
  const { commandOpen, setCommandOpen, recentSearches, addRecentSearch } = useStore()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null!)
  const navigate = useNavigate()
  const lp = useLocalizedPath()
  const [apiProducts, setApiProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string; count: number }[]>([])

  // Fetch products and categories from API
  useEffect(() => {
    let cancelled = false
    Promise.all([
      storefront.products.list({ limit: '50' }).catch(() => null),
      storefront.categories.list().catch(() => null),
    ]).then(([prodRes, catRes]) => {
      if (cancelled) return
      if (prodRes?.products?.length) setApiProducts(apiProductsToFrontend(prodRes.products).slice(0, 50))
      if (catRes?.categories?.length) {
        setCategories(catRes.categories.map((c: any) => ({
          id: c.slug || c.id, name: c.name, count: c._count?.products ?? c.productCount ?? 0,
        })))
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (commandOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setDebouncedQuery('')
      setActiveIndex(0)
    } else {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [commandOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen(!commandOpen)
      }
      if (e.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandOpen, setCommandOpen])

  if (!commandOpen) return null

  const q = debouncedQuery.toLowerCase().trim()

  const results: SearchResult[] = q
    ? [
        ...apiProducts
          .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
          .slice(0, 5)
          .map((p) => ({
            id: p.id,
            type: 'product' as const,
            title: p.name,
            description: `${p.brand} · ${p.sku}`,
            path: `/products?search=${encodeURIComponent(p.name)}`,
          })),
        ...pages
          .filter((p) => p.title.toLowerCase().includes(q))
          .map((p) => ({
            id: p.path,
            type: 'page' as const,
            title: p.title,
            description: p.path,
            path: p.path,
          })),
        ...categories
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => ({
            id: c.id,
            type: 'category' as const,
            title: c.name,
            description: `${c.count} products`,
            path: `/products?category=${c.id}`,
          })),
      ]
    : []

  const handleSelect = (result: SearchResult) => {
    if (q) addRecentSearch(q)
    setCommandOpen(false)
    navigate(lp(result.path))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(results[activeIndex])
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCommandOpen(false)} />
      <div className="relative w-full max-w-[600px] bg-[var(--secondary-bg)] border border-[var(--border)] shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={(val) => {
              setQuery(val)
              setActiveIndex(0)
              if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
              debounceTimerRef.current = setTimeout(() => setDebouncedQuery(val), 200)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            onClose={() => setCommandOpen(false)}
            showClose
            className="!border-0 !shadow-none"
          />
        </div>

        {!q && recentSearches.length > 0 && (
          <div className="p-4 border-b border-[var(--border)]">
            <span className="text-xs font-medium tracking-[2px] uppercase text-[var(--text-muted)] block mb-2">{t('search.recent')}</span>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((s) => (
                <button key={s} onClick={() => { setQuery(s); setDebouncedQuery(s) }} className="px-3 py-1.5 text-xs bg-surface border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{s}</button>
              ))}
            </div>
          </div>
        )}

        <SearchResultsList
          results={results}
          activeIndex={activeIndex}
          onSelect={handleSelect}
          getTypeLabel={(type) => t('search.' + type + 's')}
        />

        {q && results.length === 0 && <div className="p-8 text-center text-sm text-[var(--text-muted)]">{t('search.noResults')}</div>}
      </div>
    </div>
  )
}
