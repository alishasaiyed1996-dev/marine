import { memo } from 'react'

interface SkeletonProps {
  className?: string
}

/**
 * Shimmering placeholder block. Uses the existing `animate-shimmer`
 * keyframe (shimmerSweep) so it matches the design system. Renders as an
 * empty region with `aria-hidden` — screen readers see nothing because
 * real content swaps in once data arrives.
 */
export const Skeleton = memo(function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div aria-hidden className={`relative overflow-hidden rounded-lg bg-[var(--surface-soft)] ${className}`}>
      <div
        className="absolute inset-y-0 w-1/2 animate-shimmer bg-gradient-to-r from-transparent via-[var(--text-muted)]/15 to-transparent"
        style={{ left: '-100%' }}
      />
    </div>
  )
})

/** Skeleton that mirrors the ProductCard layout so grids don't jump on load. */
export function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden" aria-hidden>
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="p-4">
        <Skeleton className="mb-3 h-3 w-1/3" />
        <Skeleton className="mb-2 h-4 w-4/5" />
        <Skeleton className="mb-4 h-4 w-3/5" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}

/** Page-level fallback shown while a lazy route chunk is downloading. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6" aria-hidden>
      <Skeleton className="mx-auto mb-4 h-8 w-2/3 max-w-[560px]" />
      <Skeleton className="mx-auto mb-10 h-4 w-1/2 max-w-[420px]" />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
