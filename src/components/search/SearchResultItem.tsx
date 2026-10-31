import { type ComponentType } from 'react'
import { Package, FileText, LayoutGrid } from 'lucide-react'

type SearchResultType = 'product' | 'page' | 'category' | 'brand'

export interface SearchResult {
  id: string
  type: SearchResultType
  title: string
  description: string
  path: string
}

const iconMap: Record<SearchResultType, ComponentType<{ size?: number; className?: string }>> = {
  product: Package,
  page: FileText,
  category: LayoutGrid,
  brand: Package,
}

/** i18n key for each result-type badge. The `search.*` namespace uses
 *  irregular plurals ("categories"), and "brands" simply had no key — the
 *  old `t('search.' + type + 's')` spelled out missing keys like
 *  "search.categorys" for every category or brand row. */
export const SEARCH_TYPE_LABEL: Record<SearchResultType, string> = {
  product: 'search.products',
  page: 'search.pages',
  category: 'search.categories',
  brand: 'search.brands',
}

interface SearchResultItemProps {
  result: SearchResult
  isActive: boolean
  onClick: () => void
  /** Translated type label (e.g. from i18n). Falls back to the raw type string. */
  typeLabel?: string
}

/**
 * A single search result row with icon, title, description, and type badge.
 * Used by both CommandSearch overlay and the Search page.
 */
export function SearchResultItem({ result, isActive, onClick, typeLabel }: SearchResultItemProps) {
  const Icon = iconMap[result.type] || Package

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-[3px] cursor-pointer ${
        isActive
          ? 'bg-accent-blue/10 border-l-accent-blue'
          : 'border-l-transparent hover:bg-[var(--surface-soft)]'
      }`}
    >
      <Icon size={16} className={`flex-shrink-0 ${isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{result.title}</div>
        <div className={`text-xs truncate ${isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`}>{result.description}</div>
      </div>
      <span className={`flex-shrink-0 whitespace-nowrap text-xs uppercase tracking-[1px] ${isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`}>{typeLabel || result.type}</span>
    </button>
  )
}
