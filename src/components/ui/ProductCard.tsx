import { memo, useEffect, useMemo, useRef } from 'react'
import { Check, Clock, PackageCheck, ShoppingCart, Sparkles } from 'lucide-react'
import { WhatsAppIcon } from './WhatsAppIcon'
import { Link } from 'react-router-dom'
import type { TFunction } from 'i18next'
import type { Product } from '../../types'
import { OptimizedImage } from './OptimizedImage'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { useSaleCountdown } from '../../hooks/useSaleCountdown'
import { usePrefetchOnHover } from '../../hooks/usePrefetchOnHover'
import { fetchProductDetail, productDetailQueryKey } from '../../hooks/useApiQuery'
import { useLocalizedPath } from '../../lib/locale'
import { isLightColor, getProductImageUrl } from '../../lib/utils'

interface ProductCardProps {
  product: Product
  added?: boolean
  onAddToCart?: (product: Product) => void
  t: TFunction
  compact?: boolean
}

const conditionLabel: Record<Product['condition'], string> = {
  new: 'New',
  unused: 'New old stock',
  refurbished: 'Refurbished',
  reconditioned: 'Tested',
  used: 'Used',
}

export const ProductCard = memo(function ProductCard({ product, added = false, onAddToCart, t, compact = false }: ProductCardProps) {
  const lp = useLocalizedPath()
  // product.price is already the effective price (adapter sets it to salePrice when on sale)
  const displayPrice = product.onSale && product.salePrice ? product.salePrice : product.price
  // Original (pre-sale) price — the adapter passes it through as regularPrice
  const regularPrice = product.regularPrice ?? product.price
  const offPct =
    product.onSale && product.salePrice && regularPrice > product.salePrice
      ? Math.round((1 - product.salePrice / regularPrice) * 100)
      : 0
  const countdown = useSaleCountdown(product.saleEndsAt)
  // A live sale window inside the next 24h gets an urgent "ends soon" highlight.
  const endsSoon = Boolean(countdown && !countdown.expired && countdown.days === 0)
  const canBuy = product.inStock && Boolean(onAddToCart)
  const { whatsappNumber } = useStoreSettings()
  const whatsappText = encodeURIComponent('Hi, I need a quote for ' + product.name + ' (SKU: ' + product.sku + ').')

  // Warm the product-detail cache on hover so clicking the card opens the
  // detail page instantly (no loading screen) — fires once per card. The key
  // must match the route param used by ProductDetail (slug) and the prefetched
  // value must be the adapted frontend shape, exactly like `useProductDetail`.
  const detailKey = product.slug || product.id
  const detailQueryKey = useMemo(() => productDetailQueryKey(detailKey), [detailKey])
  const prefetchDetail = usePrefetchOnHover(detailQueryKey, () => fetchProductDetail(detailKey))

  // Touch devices never hover, so tapping a card always paid the full
  // HTML → JS → API waterfall. Warm the same cache when the card scrolls
  // into view instead — but only if it STAYS visible (600 ms dwell), so
  // fast scrolling doesn't fire a request per card.
  const cardRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let dwell: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting)
      if (visible && !dwell) {
        dwell = setTimeout(() => { prefetchDetail(); io.disconnect() }, 600)
      } else if (!visible && dwell) {
        clearTimeout(dwell)
        dwell = null
      }
    }, { rootMargin: '200px 0px' })
    io.observe(el)
    return () => {
      if (dwell) clearTimeout(dwell)
      io.disconnect()
    }
  }, [prefetchDetail])
  const stockClassName = 'rounded-full px-2.5 py-1 text-[11px] font-black ' + (product.inStock ? 'bg-success text-[var(--btn-success-text)]' : 'bg-[var(--navy-deep)] text-white')
  const buttonClassName = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-black uppercase tracking-[0.08em] transition ' + (
    !product.inStock
      ? 'cursor-not-allowed border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-muted)]'
      : added
      ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
      : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)] shadow-[0_4px_16px_var(--focus-ring)] hover:-translate-y-0.5 hover:bg-[var(--accent-primary-hover)]'
  )

  return (
    <article ref={cardRef} className="group card relative flex h-full flex-col overflow-hidden" onMouseEnter={prefetchDetail}>
      <Link to={lp('/product/' + (product.slug || product.id))} className="relative block overflow-hidden bg-[var(--surface-raised)] no-underline">
        {/* object-contain on a padded stage: product photos keep their full
            shape (nameplates, IMPA codes stay readable) instead of being
            cropped by object-cover. transformWidth caps uploads at 600px. */}
        <div className={"w-full flex items-center justify-center p-3 " + (compact ? "aspect-[4/3]" : "aspect-square")}>
          <OptimizedImage
            src={getProductImageUrl(product.filename, 0)}
            alt={product.name}
            className={"h-full w-full object-contain transition duration-700 group-hover:scale-[1.06]"}
            width={420}
            height={compact ? 315 : 420}
            transformWidth={600}
            loading="lazy"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--overlay-dark)] to-transparent opacity-80" />

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          {offPct > 0 && (
            <span className="rounded-full bg-[var(--danger)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--btn-danger-text)] shadow-lg">
              -{offPct}% {t('product.sale')}
            </span>
          )}
          {product.customLabel && (
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] shadow-lg"
              style={{ backgroundColor: product.customLabelColor || '#159a67', color: isLightColor(product.customLabelColor || '#159a67') ? '#1a1a1a' : '#ffffff' }}
            >
              {product.customLabel}
            </span>
          )}
          {product.availability === 'emergency' && (
            <span className="rounded-full border border-[var(--danger)]/30 bg-[var(--danger)]/95 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--btn-danger-text)] shadow-lg">
              {t('product.emergency')}
            </span>
          )}
        </div>

        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
          <span className="rounded-full border border-white/15 bg-white/90 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--navy-deep)] backdrop-blur dark:bg-white/85">
            {product.brand}
          </span>
          <span className={stockClassName}>
            {product.inStock ? t('product.inStockCount', { count: product.stockCount }) : t('product.outOfStockCount')}
          </span>
        </div>

        {!product.inStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--overlay-dark)]">
            <span className="rounded-xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-[var(--navy-deep)]">
              {t('product.outOfStock')}
            </span>
          </div>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          <PackageCheck size={13} className="text-[var(--accent-teal)]" />
          <span>{conditionLabel[product.condition]}</span>
          <span className="h-1 w-1 rounded-full bg-[var(--border)]" />
          <span className="truncate">{product.sku}</span>
        </div>

        <h3 className="line-clamp-2 min-h-[48px] font-display text-[1.05rem] font-bold leading-[1.3] tracking-tight text-[var(--text-primary)]">
          <Link to={lp('/product/' + (product.slug || product.id))} className="no-underline transition-colors hover:text-[var(--accent-primary)]">
            {product.name}
          </Link>
        </h3>

        {!compact && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            Verified marine & industrial spare, ready for RFQ, purchase, or export dispatch.
          </p>
        )}

        <div className="mt-auto pt-4">
          {countdown && !countdown.expired && product.onSale && (
          <div
            className={
              'mb-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] ' +
              (endsSoon
                ? 'animate-danger-pulse border border-[var(--danger)] bg-[var(--danger)] text-[var(--btn-danger-text)]'
                : 'border border-danger/20 bg-danger/10 text-[var(--danger)]')
            }
          >
            <Clock size={11} className="shrink-0" />
            <span>{endsSoon ? t('product.endsSoon') : t('product.saleEndsIn')}</span>
            <span className="ml-auto font-mono tabular-nums">
              {countdown.days > 0 && <>{countdown.days}d </>}
              {String(countdown.hours).padStart(2, '0')}:{String(countdown.minutes).padStart(2, '0')}:{String(countdown.seconds).padStart(2, '0')}
            </span>
          </div>
        )}

        <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">Buyer price</span>
              {product.onSale && product.salePrice ? (
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-black tabular-nums text-[var(--danger)]">
                    {'$'}{product.salePrice.toFixed(2)}
                  </span>
                  <span className="font-display text-sm font-bold text-[var(--text-muted)] line-through">
                    {'$'}{regularPrice.toFixed(2)}
                  </span>
                </div>
              ) : (
                <span className="font-display text-2xl font-black tabular-nums text-[var(--text-primary)]">
                  {'$'}{displayPrice.toFixed(2)}
                </span>
              )}
            </div>
            <Link
              to={lp('/product/' + (product.slug || product.id))}
              className="rounded-full border border-[var(--border)] px-3 py-2 text-[11px] font-extrabold text-[var(--text-secondary)] no-underline transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            >
              Details
            </Link>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => canBuy && onAddToCart?.(product)}
              disabled={!canBuy}
              className={buttonClassName}
            >
              {!product.inStock ? (
                t('product.outOfStock')
              ) : added ? (
                <><Check size={14} /> {t('product.added')}</>
              ) : (
                <><ShoppingCart size={14} /> {t('product.addToCart')}</>
              )}
            </button>
            <a
              href={`https://wa.me/${whatsappNumber}?text=${whatsappText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--success)] no-underline transition hover:-translate-y-0.5 hover:border-[var(--success)]"
              aria-label={'WhatsApp quote for ' + product.name}
            >
              <WhatsAppIcon size={17} />
            </a>
          </div>
        </div>
      </div>

      {product.makeOffer && (
        <span className="pointer-events-none absolute right-3 top-3 hidden rounded-full border border-white/15 bg-[var(--overlay-medium)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white backdrop-blur sm:inline-flex">
          <Sparkles size={11} className="mr-1 text-[var(--gold-light)]" /> Offer
        </span>
      )}
    </article>
  )
})
