import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CornerDownLeft,
  FolderPlus,
  Plus,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { ADMIN_NAV_GROUPS, canSeeAdminNavItem, type AdminNavItem } from './adminNav'

const RECENT_KEY = 'admin-command-recent-v1'
const MAX_RECENT = 4

// Focus target restored after the palette closes. Deliberately a module value
// rather than a ref: the palette's handlers close over it and the React
// compiler lint rule treats a ref read inside those closures as a render read.
let lastFocusedElement: HTMLElement | null = null

interface PaletteEntry {
  id: string
  label: string
  description: string
  section: string
  to: string
  icon: LucideIcon
  keywords: string
}

const QUICK_ACTIONS: PaletteEntry[] = [
  { id: 'new-product', label: 'New product', description: 'Create a catalog product', section: 'Quick actions', to: '/admin/products/new', icon: Plus, keywords: 'add create catalog sku' },
  { id: 'new-category', label: 'New category', description: 'Add a taxonomy category', section: 'Quick actions', to: '/admin/categories', icon: FolderPlus, keywords: 'add create taxonomy' },
  { id: 'ebay-sweep', label: 'eBay catalog health', description: 'Sweep results, drift and repairs', section: 'Quick actions', to: '/admin/ebay', icon: Sparkles, keywords: 'ebay sync sweep mirror listings' },
]

function navEntry(item: AdminNavItem, section: string): PaletteEntry {
  return {
    id: `nav:${item.to}`,
    label: item.label,
    description: item.to,
    section,
    to: item.to,
    icon: item.icon,
    keywords: `${item.keywords || ''} ${item.label} ${item.to}`.toLowerCase(),
  }
}

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export function AdminCommandPalette() {
  const navigate = useNavigate()
  const role = useStore((s) => s.adminUser?.role)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const navigationEntries = useMemo(
    () => ADMIN_NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => canSeeAdminNavItem(item, role))
        .map((item) => navEntry(item, group.label)),
    ),
    [role],
  )

  const results = useMemo(() => {
    const all = [...QUICK_ACTIONS, ...navigationEntries]
    const q = query.trim().toLowerCase()
    if (!q) {
      const recentEntries = recent
        .map((id) => all.find((entry) => entry.id === id))
        .filter((entry): entry is PaletteEntry => Boolean(entry))
      const rest = all.filter((entry) => !recent.some((id) => id === entry.id))
      return [
        ...recentEntries.map((entry) => ({ ...entry, section: 'Recent' })),
        ...rest,
      ]
    }
    return all.filter((entry) =>
      `${entry.label} ${entry.description} ${entry.section} ${entry.keywords}`.toLowerCase().includes(q),
    )
  }, [query, recent, navigationEntries])

  const openPalette = useCallback(() => {
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActiveIndex(0)
    setOpen(true)
  }, [])

  const closePalette = useCallback(() => {
    setOpen(false)
    lastFocusedElement?.focus?.()
    lastFocusedElement = null
  }, [])

  // Global shortcut + the sidebar's search button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => {
          if (prev) return false
          lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
          setQuery('')
          setActiveIndex(0)
          return true
        })
      }
      if (event.key === 'Escape') setOpen(false)
    }
    const onOpenRequest = () => openPalette()
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('admin:open-command', onOpenRequest)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('admin:open-command', onOpenRequest)
    }
  }, [openPalette])

  // Focus the input, lock background scroll, restore on close.
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(frame)
    }
  }, [open])

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    if (!open) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const select = useCallback((entry: PaletteEntry) => {
    const nextRecent = [entry.id, ...recent.filter((id) => id !== entry.id)].slice(0, MAX_RECENT)
    setRecent(nextRecent)
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent))
    } catch {
      // Recent history is a nicety; ignore storage failures.
    }
    closePalette()
    navigate(entry.to)
  }, [closePalette, navigate, recent])

  if (!open) return null

  const optionId = (index: number) => `admin-cmd-option-${index}`

  return (
    <div
      className="admin-cmd-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div
        className="admin-cmd"
        role="dialog"
        aria-modal="true"
        aria-label="Admin command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-cmd-input-row">
          <Search size={17} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const entry = results[activeIndex]
                if (entry) select(entry)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closePalette()
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-cmd-list"
            aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            placeholder="Search pages, actions…"
            className="admin-cmd-input"
            data-testid="admin-command-input"
          />
          <button type="button" onClick={closePalette} className="admin-cmd-close" aria-label="Close command palette">
            <X size={15} />
          </button>
        </div>

        <div id="admin-cmd-list" role="listbox" aria-label="Command results" className="admin-cmd-list">
          {results.length === 0 ? (
            <div className="admin-cmd-empty">
              <Search size={18} className="mb-2 opacity-40" />
              <p>No pages or actions match “{query.trim()}”.</p>
            </div>
          ) : results.map((entry, index) => {
            const Icon = entry.icon
            const previous = results[index - 1]
            const showSection = !previous || previous.section !== entry.section
            return (
              <div key={entry.id}>
                {showSection && <p className="admin-cmd-section">{entry.section}</p>}
                <button
                  ref={(element) => { itemRefs.current[index] = element }}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(entry)}
                  className={`admin-cmd-option ${index === activeIndex ? 'is-active' : ''}`}
                >
                  <span className="admin-cmd-option-icon"><Icon size={15} strokeWidth={1.8} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{entry.label}</span>
                    <span className="block truncate text-[0.6875rem] opacity-60">{entry.description}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 opacity-40" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="admin-cmd-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><CornerDownLeft size={11} aria-hidden="true" /> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
