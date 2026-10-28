import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  placeholder?: string
  loading?: boolean
  onClose?: () => void
  className?: string
  /** Show the X close button (e.g. in CommandSearch overlay) */
  showClose?: boolean
}

/**
 * Shared search input with optional loading indicator and close button.
 * Used by both CommandSearch overlay and the Search page.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, onKeyDown, placeholder = 'Search...', loading = false, onClose, className = '', showClose = false },
    ref,
  ) {
    const { t } = useTranslation()
    return (
      <div className={`relative ${className}`}>
        {/* Logical (start/end) positioning so the icon and paddings mirror
            correctly under dir=rtl */}
        <Search size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] flex-shrink-0" />
        <input
          ref={ref}
          type="text"
          enterKeyHint="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full ps-11 pe-12 py-4 bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] transition-all rounded-xl"
        />
        {loading && (
          <div className="absolute end-12 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {showClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('a11y.closeSearch')}
            className="tap-native absolute end-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-11 h-11 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        )}
      </div>
    )
  },
)
