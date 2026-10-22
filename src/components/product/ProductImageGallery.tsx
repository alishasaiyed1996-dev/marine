import { useState, useCallback, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, Share2, ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OptimizedImage } from '../ui/OptimizedImage'
import { getProductImageUrl, isLightColor } from '../../lib/utils'
import { buildImageAlt } from '../../lib/seo/productSeo'
import type { Product } from '../../types'

interface ProductImageGalleryProps {
  product: Product
}

/**
 * Full product gallery:
 *  - Main stage renders the SELECTED image (previously only the first one was
 *    ever shown, so uploaded extra photos were invisible) at the full width of
 *    the detail column — the old `max-h-[450px]` clamp is gone.
 *  - Thumbnail strip below the main image (one per uploaded photo, with the
 *    active one highlighted) — standard e-commerce pattern.
 *  - Prev/next arrows + keyboard ← → navigation.
 *  - Desktop hover zoom, mobile pinch / double-tap zoom preserved.
 *  - Graceful handling when a product has no images at all (placeholder icon).
 */
export function ProductImageGallery({ product }: ProductImageGalleryProps) {
  const { t } = useTranslation()
  const [showZoom, setShowZoom] = useState(false)
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 })
  const [showShare, setShowShare] = useState(false)
  // Touch zoom state
  const [touchScale, setTouchScale] = useState(1)
  const [touchOrigin, setTouchOrigin] = useState({ x: 50, y: 50 })
  const lastTouchDistance = useRef<number | null>(null)
  const lastTapTime = useRef<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Image list: fall back to the shared placeholder when empty ──
  const images = product.images?.length
    ? product.images
    : [{ url: getProductImageUrl(product.filename, 1200), alt: product.name, label: undefined as string | undefined }]
  const hasImages = images.length > 0

  const [activeIndex, setActiveIndex] = useState(0)
  const active = images[Math.min(activeIndex, images.length - 1)]

  // Navigating between products reuses this component instance, so every
  // per-product state (selected photo, zoom/share) must be reset — otherwise
  // the new gallery opens on a stale index.
  useEffect(() => {
    setActiveIndex(0)
    setShowZoom(false)
    setZoomPos({ x: 50, y: 50 })
    setShowShare(false)
    setTouchScale(1)
    setTouchOrigin({ x: 50, y: 50 })
    lastTouchDistance.current = null
    lastTapTime.current = 0
  }, [product.id])

  const goPrev = useCallback(() => {
    setTouchScale(1)
    setActiveIndex((i) => (i - 1 + images.length) % images.length)
  }, [images.length])

  const goNext = useCallback(() => {
    setTouchScale(1)
    setActiveIndex((i) => (i + 1) % images.length)
  }, [images.length])

  // Keyboard navigation (← →) while the gallery is on screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext])

  // ── Desktop: mouse hover zoom ──
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!showZoom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoomPos({ x, y })
  }, [showZoom])

  // ── Mobile: pinch-to-zoom ──
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastTouchDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && lastTouchDistance.current !== null) {
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const scaleDelta = distance / lastTouchDistance.current
      lastTouchDistance.current = distance

      setTouchScale((prev) => {
        const next = Math.min(Math.max(prev * scaleDelta, 1), 3)
        if (next <= 1) {
          setTouchOrigin({ x: 50, y: 50 })
        }
        return next
      })

      // Set zoom origin to midpoint of the two fingers
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) / rect.width * 100
        const midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) / rect.height * 100
        setTouchOrigin({ x: midX, y: midY })
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    lastTouchDistance.current = null
  }, [])

  // ── Mobile: double-tap to zoom ──
  const handleDoubleTap = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const now = Date.now()
    if (now - lastTapTime.current < 300) {
      if (touchScale > 1) {
        setTouchScale(1)
        setTouchOrigin({ x: 50, y: 50 })
      } else {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const x = ((e.touches[0]?.clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width * 100
          const y = ((e.touches[0]?.clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height * 100
          setTouchOrigin({ x, y })
        }
        setTouchScale(2)
      }
    }
    lastTapTime.current = now
  }, [touchScale])

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: product?.name || 'Alka Traders Product', url })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') navigator.clipboard?.writeText(url)
      }
    } else {
      navigator.clipboard?.writeText(url)
      setShowShare(true)
      setTimeout(() => setShowShare(false), 2000)
    }
  }

  const isZoomed = showZoom || touchScale > 1
  const isMulti = images.length > 1

  return (
    <>
      <div
        ref={containerRef}
        className="relative bg-[var(--secondary-bg)] border border-[var(--border)] p-3 sm:p-4 rounded-2xl overflow-hidden group cursor-crosshair touch-none"
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setShowZoom(true)}
        onMouseLeave={() => setShowZoom(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* ── Main stage: full column width, no max-h clamp ── */}
        <div
          className="relative overflow-hidden rounded-xl bg-[var(--primary-bg)] aspect-square w-full flex items-center justify-center"
          onTouchEnd={handleDoubleTap}
        >
          {hasImages ? (
            <OptimizedImage
              key={active.url}
              src={active.url}
              alt={active.alt || buildImageAlt(product.name, product)}
              width={1200}
              height={1200}
              loading="eager"
              fetchPriority="high"
              sizes="(max-width: 1024px) 100vw, 55vw"
              transformWidth={1200}
              className={`w-full h-full object-contain transition-transform duration-200 ${
                showZoom ? 'scale-150' : touchScale > 1 ? '' : 'scale-100'
              }`}
              style={{
                transform: showZoom
                  ? 'scale(1.5)'
                  : touchScale > 1
                  ? `scale(${touchScale})`
                  : undefined,
                transformOrigin: showZoom
                  ? `${zoomPos.x}% ${zoomPos.y}%`
                  : `${touchOrigin.x}% ${touchOrigin.y}%`,
              }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]" aria-hidden>
              <ImageOff size={40} strokeWidth={1.5} />
              <span className="text-xs font-mono uppercase tracking-wider">{t('product.noImage')}</span>
            </div>
          )}

          {/* Prev / next arrows — only when there are multiple photos */}
          {isMulti && hasImages && (
            <>
              <button
                onClick={goPrev}
                aria-label={t('product.prevImage')}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-[var(--surface)]/90 border border-[var(--border)] flex items-center justify-center shadow-sm hover:border-[var(--accent-primary)] transition-colors cursor-pointer"
              >
                <ChevronLeft size={18} className="text-[var(--text-primary)]" />
              </button>
              <button
                onClick={goNext}
                aria-label={t('product.nextImage')}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-[var(--surface)]/90 border border-[var(--border)] flex items-center justify-center shadow-sm hover:border-[var(--accent-primary)] transition-colors cursor-pointer"
              >
                <ChevronRight size={18} className="text-[var(--text-primary)]" />
              </button>
              {/* Photo counter, e.g. 3 / 7 */}
              <span className="absolute bottom-3 left-3 z-10 bg-black/60 backdrop-blur-sm text-white text-xs font-mono px-2.5 py-1 rounded-full">
                {Math.min(activeIndex + 1, images.length)} / {images.length}
              </span>
            </>
          )}

          {/* Desktop zoom hint */}
          <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-xs text-white px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 opacity-0 group-hover:opacity-80 transition-opacity max-sm:hidden pointer-events-none">
            <ZoomIn size={12} /> {t('product.hoverToZoom')}
          </div>

          {/* Zoom indicator when zoomed */}
          {isZoomed && (
            <button
              onClick={() => {
                setShowZoom(false)
                setTouchScale(1)
                setTouchOrigin({ x: 50, y: 50 })
              }}
              className="absolute top-3 right-3 z-20 bg-black/60 backdrop-blur-sm text-xs text-white px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5"
            >
              {Math.round(showZoom ? 150 : touchScale * 100)}% — tap to reset
            </button>
          )}

          {product.customLabel && (
            <span
              className="absolute top-3 left-3 z-10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider rounded-lg shadow-lg"
              style={{
                backgroundColor: product.customLabelColor || '#159a67',
                color: isLightColor(product.customLabelColor || '#159a67') ? '#1a1a1a' : '#ffffff',
              }}
            >
              {product.customLabel}
            </span>
          )}

          {!product.inStock && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 pointer-events-none">
              <span className="text-white font-bold text-lg bg-black/70 px-6 py-3 rounded-xl">{t('product.outOfStock')}</span>
            </div>
          )}
        </div>

        {/* ── Thumbnail strip ── */}
        {isMulti && hasImages && (
          <div className="mt-3 grid grid-cols-6 sm:grid-cols-7 gap-2" role="tablist" aria-label={t('product.ariaGalleryThumbs')}>
            {images.map((img, idx) => (
              <button
                key={img.url + idx}
                role="tab"
                aria-selected={idx === activeIndex}
                aria-label={`${t('product.ariaViewImage')} ${idx + 1}`}
                onClick={() => {
                  setActiveIndex(idx)
                  setTouchScale(1)
                }}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-[var(--primary-bg)] transition-colors cursor-pointer p-0 ${
                  idx === activeIndex
                    ? 'border-[var(--accent-primary)]'
                    : 'border-[var(--border)] hover:border-[var(--accent-gold)]'
                }`}
              >
                <OptimizedImage
                  src={img.url}
                  alt=""
                  width={120}
                  height={120}
                  loading="lazy"
                  sizes="90px"
                  transformWidth={200}
                  className="w-full h-full object-contain"
                />
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleShare}
          className="absolute top-6 right-6 z-10 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 hover:border-[var(--accent-gold)] transition-colors"
          aria-label={t('product.ariaShare')}
        >
          <Share2 size={16} className="text-[var(--text-secondary)]" />
        </button>
      </div>
      {showShare && (
        <div className="mt-2 bg-[var(--success)] text-[var(--btn-success-text)] text-xs font-bold px-4 py-2 rounded-lg inline-block">
          {t('product.linkCopied')}
        </div>
      )}
    </>
  )
}
