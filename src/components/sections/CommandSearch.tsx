import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store/useStore'
import { storefront } from '../../lib/api'
import { useLocalizedPath } from '../../lib/locale'
import { useOverlayBehavior } from '../../lib/overlay'
import { SearchInput, SearchResultsList } from '../search'
import type { SearchResult } from '../search'

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
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])

  // Query the full-text search endpoint so results are not limited to the
  // first catalogue page. The backend already returns product slugs and
  // category/brand slug filters.
  useEffect(() => {
    const term = debouncedQuery.trim()
    if (!term) {
      setSearchResults([])
      return
    }
    let cancelled = false
    storefront.search(term)
      .then((res) => {
        if (cancelled) return
        setSearchResults((res.results || []).map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title || r.name || '',
          description: r.description || r.brand || '',
          path: r.path || (r.type === 'product' && r.slug
            ? `/product/${r.slug}`
            : r.type === 'category' && r.slug
              ? `/products?category=${r.slug}`
              : r.type === 'brand' && r.slug
                ? `/products?brand=${r.slug}`
                : '/products'),
        })))
      })
      .catch(() => { if (!cancelled) setSearchResults([]) })
    return () => { cancelled = true }
  }, [debouncedQuery])

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

  // Cmd/Ctrl+K toggles (desktop); Escape + focus trap + scroll lock + focus
  // restore come from the shared overlay behavior. The palette is ALSO opened
  // from the navbar search button (the only way to reach it on touch devices,
  // which have no Cmd/Ctrl key).
  const panelRef = useRef<HTMLDivElement>(null)
  useOverlayBehavior({
    open: commandOpen,
    onClose: () => setCommandOpen(false),
    panelRef,
    initialFocusRef: inputRef,
    lockKey: 'command',
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen(!commandOpen)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [commandOpen, setCommandOpen])

  if (!commandOpen) return null

  const q = debouncedQuery.toLowerCase().trim()

  const results: SearchResult[] = q
    ? [
        ...searchResults,
        ...pages
          .filter((p) => p.title.toLowerCase().includes(q))
          .map((p) => ({
            id: p.path,
            type: 'page' as const,
            title: p.title,
            description: p.path,
            path: p.path,
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
      const selected = results[activeIndex]
      if (selected) handleSelect(selected)
    }
  }

  return (
    // pt-[12svh] and the internal max-height keep the palette inside short
    // viewports (landscape phones); the panel itself scrolls with
    // overscroll containment so iOS can't rubber-band the page behind it.
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12svh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCommandOpen(false)} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.placeholder')}
        data-modal="command"
        className="relative max-h-[74dvh] w-full max-w-[600px] overflow-y-auto overscroll-contain bg-[var(--secondary-bg)] border border-[var(--border)] shadow-2xl outline-none"
      >
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
