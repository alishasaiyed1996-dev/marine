import { Link } from 'react-router-dom'
import { useLocalizedPath } from '../../lib/locale'
import { useTranslation } from 'react-i18next'
import { OptimizedImage } from '../ui/OptimizedImage'
import { getProductImageUrl, isLightColor, formatMoney } from '../../lib/utils'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { buildImageAlt } from '../../lib/seo/productSeo'
import type { Product } from '../../types'

interface RelatedProductsProps {
  products: Product[]
}

export function RelatedProducts({ products }: RelatedProductsProps) {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  const { currency: storeCurrency } = useStoreSettings()

  if (products.length === 0) return null

  return (
    <section className="mt-16 pt-10 border-t border-[var(--border)] text-left">
      <h2 className="heading-xl mb-6 text-[var(--text-primary)]">{t('product.relatedProducts')}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {products.map((item) => {
          const itemPrice = item.onSale && item.salePrice ? item.salePrice : item.price
          // `price` is already the effective sale price; the pre-sale amount is
          // carried separately in `regularPrice`.
          const regularPrice = item.regularPrice ?? item.price
          return (
            <div
              key={item.id}
              className="bg-[var(--secondary-bg)] border border-[var(--border)] overflow-hidden transition-all duration-300 hover:border-l-[var(--accent-primary)] hover:-translate-y-1 rounded-xl group flex flex-col justify-between"
            >
              <Link to={lp(`/product/${item.slug || item.id}`)} className="overflow-hidden bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-center relative block">
                {/* object-contain: related photos keep their full shape instead
                    of being cropped by object-cover */}
                <div className="aspect-square w-full flex items-center justify-center p-3">
                  <OptimizedImage
                    src={getProductImageUrl(item.filename, 0)}
                    alt={buildImageAlt(item.name, item)}
                    width={400}
                    height={400}
                    transformWidth={600}
                    loading="lazy"
                    sizes="(max-width: 1024px) 50vw, 25vw"
                    className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-110"
                  />
                </div>
                {item.customLabel && (
                  <span
                    className="absolute top-2 left-2 z-10 px-2 py-0.5 text-xs font-extrabold uppercase rounded"
                    style={{
                      backgroundColor: item.customLabelColor || '#159a67',
                      color: isLightColor(item.customLabelColor || '#159a67') ? '#1a1a1a' : '#ffffff',
                    }}
                  >
                    {item.customLabel}
                  </span>
                )}
              </Link>
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <span className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wider block mb-1">{item.brand}</span>
                  <Link to={lp(`/product/${item.slug || item.id}`)} className="text-xs font-semibold leading-tight text-[var(--text-primary)] hover:text-[var(--accent-primary)] block mb-2 line-clamp-2">
                    {item.name}
                  </Link>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]/40">
                  <div className="flex items-center gap-2">
                    {item.onSale && item.salePrice && regularPrice > item.salePrice ? (
                      <>
                        <span className="font-display font-bold text-sm text-[var(--danger)]">{formatMoney(item.salePrice, item.currency || storeCurrency)}</span>
                        <span className="font-display font-bold text-xs text-[var(--text-muted)] line-through">{formatMoney(regularPrice, item.currency || storeCurrency)}</span>
                      </>
                    ) : (
                      <span className="font-display font-bold text-sm text-[var(--accent-primary)]">{formatMoney(itemPrice, item.currency || storeCurrency)}</span>
                    )}
                  </div>
                  <Link to={lp(`/product/${item.slug || item.id}`)} className="text-xs font-semibold text-[var(--accent-primary)] hover:underline">
                    {t('product.viewInfo')}
                  </Link>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
