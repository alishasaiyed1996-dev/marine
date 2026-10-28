import { Link, useLocation } from 'react-router-dom'

interface ProductPaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

/**
 * Crawlable pagination (roadmap B19): page links are real <a href> anchors so
 * Googlebot can discover paginated product pages without executing JS. The
 * href preserves the current filter query string and swaps ?page=N; onClick
 * still drives the SPA transition (with scroll reset) so users get the same
 * experience as before.
 */
export function ProductPagination({ currentPage, totalPages, onPageChange }: ProductPaginationProps) {
  const location = useLocation()

  if (totalPages <= 1) return null

  const hrefFor = (page: number): string => {
    const params = new URLSearchParams(location.search)
    if (page <= 1) params.delete('page')
    else params.set('page', String(page))
    const qs = params.toString()
    return qs ? `${location.pathname}?${qs}` : location.pathname
  }

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (arr[i - 1] as number) < p - 1) acc.push('...')
      acc.push(p)
      return acc
    }, [])

  const linkClass =
    'tap-native inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)]'

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 mt-8">
      {currentPage > 1 ? (
        <Link
          to={hrefFor(currentPage - 1)}
          onClick={(e) => { e.preventDefault(); onPageChange(currentPage - 1) }}
          className={linkClass}
          rel="prev"
        >
          ← Prev
        </Link>
      ) : (
        <span className={`${linkClass} cursor-not-allowed opacity-30`}>← Prev</span>
      )}
      {pages.map((p, i) =>
        typeof p === 'string' ? (
          <span key={`dots-${i}`} className="flex h-11 items-center px-1 text-xs text-[var(--text-muted)]">…</span>
        ) : p === currentPage ? (
          <span
            key={p}
            aria-current="page"
            className="tap-native inline-flex h-11 min-w-11 items-center justify-center rounded-lg text-xs font-bold transition-colors border border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)]"
          >
            {p}
          </span>
        ) : (
          <Link
            key={p}
            to={hrefFor(p)}
            onClick={(e) => { e.preventDefault(); onPageChange(p) }}
            className={`tap-native inline-flex h-11 min-w-11 items-center justify-center rounded-lg text-xs font-bold transition-colors border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--accent-primary)]`}
          >
            {p}
          </Link>
        )
      )}
      {currentPage < totalPages ? (
        <Link
          to={hrefFor(currentPage + 1)}
          onClick={(e) => { e.preventDefault(); onPageChange(currentPage + 1) }}
          className={linkClass}
          rel="next"
        >
          Next →
        </Link>
      ) : (
        <span className={`${linkClass} cursor-not-allowed opacity-30`}>Next →</span>
      )}
    </div>
  )
}
