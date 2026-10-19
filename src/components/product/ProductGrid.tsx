import { Link } from 'react-router-dom'
import { ShoppingCart, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OptimizedImage } from '../ui/OptimizedImage'
import { ProductCardSkeleton } from '../ui/Skeleton'
import { isLightColor, getProductImageUrl } from '../../lib/utils'
import { buildImageAlt } from '../../lib/seo/productSeo'
import type { Product } from '../../types'

interface ProductGridProps {
  products: Product[]
  addedIds: Set<string>
  onAddToCart: (product: Product) => void
  isLoading?: boolean
}

function ProductCard({ product, addedIds, onAddToCart }: { product: Product; addedIds: Set<string>; onAddToCart: (product: Product) => void }) {
  const { t } = useTranslation()
  const effPrice = product.onSale && product.salePrice ? product.salePrice : product.price
  const isAdded = addedIds.has(product.id)

  return (
    <div className="card flex h-full flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[var(--accent-primary)] group">
      <Link to={`/product/${product.slug || product.id}`} className="block relative overflow-hidden bg-[var(--surface)] border-b border-[var(--border)]">
        {/* object-contain on a padded neutral stage: product photos keep their
            full shape (IMPA codes, nameplates and labels stay readable) instead
            of being cropped like object-cover did. transformWidth caps uploaded
            full-URL images at 600px instead of shipping 2000px originals. */}
        <div className="aspect-square w-full flex items-center justify-center p-3">
          <OptimizedImage
            src={getProductImageUrl(product.filename, 0)}
            alt={buildImageAlt(product.name, product)}
            width={400}
            height={400}
            transformWidth={600}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        </div>
        {product.customLabel && (
          <span
            className="absolute top-2 left-2 z-10 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider rounded"
            style={{ backgroundColor: product.customLabelColor || '#159a67', color: isLightColor(product.customLabelColor || '#159a67') ? '#1a1a1a' : '#ffffff' }}
          >
            {product.customLabel}
          </span>
        )}
        {product.availability === 'emergency' && (
          <span className="absolute top-2 right-2 z-10 px-2 py-1 rounded-full text-xs font-mono border border-[var(--danger)]/20 text-[var(--danger)] bg-white">
            {t('product.emergency')}
          </span>
        )}
        {!product.inStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-bold text-sm bg-black/70 px-4 py-2 rounded-lg">{t('product.outOfStock')}</span>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        {/* Brand chip — fixed height row so every card's title starts at the
            same vertical position regardless of chip wrapping */}
        <div className="min-h-[26px] mb-2">
          <span className="inline-block font-mono text-xs px-2 py-0.5 rounded-full border text-[var(--accent-primary)] border-[var(--accent-primary)]/15 bg-[var(--accent-primary)]/5">
            {product.brand}
          </span>
        </div>
        <h4 className="text-label leading-tight hover:text-[var(--accent-primary)] transition-colors min-h-[40px]">
          <Link to={`/product/${product.slug || product.id}`}>{product.name}</Link>
        </h4>
        <span className="font-mono text-xs text-[var(--text-muted)] block mt-1">
          {t('product.skuPrefix', { sku: product.sku })}
        </span>
        <div className="mt-auto pt-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              {product.onSale && product.salePrice ? (
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold text-xl tracking-tight tabular-nums text-[var(--danger)]">
                    ${product.salePrice.toFixed(2)}
                  </span>
                  <span className="font-display font-bold text-sm text-[var(--text-muted)] line-through">
                    ${product.price.toFixed(2)}
                  </span>
                </div>
              ) : (
                <span className="font-display font-bold text-xl tracking-tight tabular-nums text-[var(--text-primary)]">
                  ${effPrice.toFixed(2)}
                </span>
              )}
            </div>
            <span className={`text-xs font-bold text-right shrink-0 ${product.inStock ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
              {product.inStock ? t('product.inStockCount', { count: product.stockCount }) : t('product.outOfStockCount')}
            </span>
          </div>
          <button
            onClick={() => { if (!product.inStock) return; onAddToCart(product) }}
            disabled={!product.inStock}
            className={`mt-3 inline-flex items-center justify-center w-full gap-2 text-xs font-bold px-[18px] py-[11px] transition-all duration-300 border cursor-pointer rounded-lg ${
              !product.inStock
                ? 'border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text-muted)] cursor-not-allowed'
                : isAdded
                  ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
                  : 'btn-primary border-none'
            }`}
          >
            {!product.inStock
              ? t('product.outOfStock')
              : isAdded
                ? <><Check size={14} /> {t('product.added')}</>
                : <><ShoppingCart size={14} /> {t('product.addToCart')}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProductGrid({ products, addedIds, onAddToCart, isLoading }: ProductGridProps) {

  if (isLoading) {
    // Skeleton grid keeps the exact card layout painted while data loads, so
    // the page never collapses to a spinner or flashes white.
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (products.length === 0) {
    return null // handled by parent
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          addedIds={addedIds}
          onAddToCart={onAddToCart}
        />
      ))}
    </div>
  )
}
