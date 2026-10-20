import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  ShoppingCart,
  Check,
  ShieldCheck,
  Truck,
  RotateCcw,
  Percent,
  Minus,
  Plus,
  MessageCircle,
} from 'lucide-react'
import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { useStore } from '../store/useStore'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import { useProductDetail } from '../hooks/useApiQuery'
import { parseDescription, buildSpecTable, sectionTitle } from '../lib/description'
import { buildProductSeo } from '../lib/seo/productSeo'
import { ProductImageGallery } from '../components/product/ProductImageGallery'
import { OfferModal } from '../components/product/OfferModal'
import { Skeleton } from '../components/ui/Skeleton'
import { RelatedProducts } from '../components/product/RelatedProducts'
import { useLocalizedPath, useLocale } from '../lib/locale'

export default function ProductDetail() {
  const { t } = useTranslation()
  const { key } = useParams()
  const id = key
  const locale = useLocale()
  const lp = useLocalizedPath()
  const navigate = useNavigate()
  const { addToCart } = useStore()
  const { whatsappNumber } = useStoreSettings()

  const [added, setAdded] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [showOfferModal, setShowOfferModal] = useState(false)

  // React Query: cached + prefetchable product detail (hover-prefetch in
  // ProductCard makes this page render instantly), same API→static fallback
  // as before, now with automatic caching and dedup.
  const { data: productData, isLoading } = useProductDetail(id)
  const product = productData?.product
  const related = productData?.related || []

  // ── Sticky mobile add-to-cart bar ─────────────────────────────
  // Shows a fixed bottom bar on mobile when the main CTA scrolls out of view.
  // These hooks MUST run before the loading/not-found early returns below —
  // otherwise the hook count changes between the loading render and the loaded
  // render and React throws "Rendered more hooks than during the previous render".
  const ctaRef = useRef<HTMLDivElement>(null)
  const [showStickyBar, setShowStickyBar] = useState(false)

  const handleCtaIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
    // Only on mobile — hide sticky bar when CTA is visible, show when hidden
    if (window.innerWidth >= 1024) return
    const entry = entries[0]
    if (entry) {
      setShowStickyBar(!entry.isIntersecting)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
    setAdded(false)
    setQuantity(1)
  }, [id])

  // Attach the observer once the CTA is actually mounted. While loading, the ref
  // is still null, so `product` is a dependency to re-run when it resolves.
  useEffect(() => {
    const el = ctaRef.current
    if (!el) return
    const observer = new IntersectionObserver(handleCtaIntersection, {
      threshold: 0,
      rootMargin: '0px 0px -80px 0px', // trigger before fully leaving viewport
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleCtaIntersection, product])

  // Reset sticky bar visibility on product change
  useEffect(() => {
    setShowStickyBar(false)
  }, [id])

  if (isLoading) {
    // Skeleton mirrors the real two-column detail layout — no layout jump,
    // no white flash, while the product data resolves.
    return (
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-12" aria-hidden>
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="space-y-4">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-7 w-4/5" />
            <Skeleton className="h-7 w-3/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-6 h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!product) {
    // B20: a missing/unpublished product must not look indexable — emit
    // noindex so Google drops soft-404 shells instead of judging the page.
    return (
      <>
      <SEO title={t('product.productNotFound')} description={t('product.productNotFoundDesc')} noindex />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-24 text-center">
        <h2 className="text-2xl font-bold mb-2">{t('product.productNotFound')}</h2>
        <p className="text-body-sm text-[var(--text-secondary)] mb-6">{t('product.productNotFoundDesc')}</p>
        <Link to={lp('/products')} className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-semibold rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all">
          <ArrowLeft size={16} /> {t('product.backToProducts')}
        </Link>
      </div>
      </>
    )
  }

  const price = product.price
  const effectivePrice = product.onSale && product.salePrice ? product.salePrice : price
  // `product.price` is the effective (sale) price after adaptation; the
  // pre-discount amount lives in `regularPrice`.
  const originalPrice = product.regularPrice && product.regularPrice > 0
    ? product.regularPrice
    : price

  // ── Categorized content ────────────────────────────────────────
  // The admin description is a free-text blob mixing "Label: value" spec
  // lines and section headers (KEY FEATURES / CONDITION / INCLUDED). Parse it
  // once so each kind of content renders in its proper place instead of one
  // wall-of-text paragraph.
  const parsedDesc = parseDescription(product.description)
  const specRows = buildSpecTable(parsedDesc, product)
  const readableCategory = product.category.replace(/-/g, ' ')
  // Structured specs saved through the admin form (name/value pairs with
  // i18n-able labels). Falls back to Brand/Category/Condition when empty.
  const formSpecs = product.specs && Object.keys(product.specs).length > 0
    ? product.specs
    : { Brand: product.brand, Category: readableCategory, Condition: product.condition }
  const hasDescriptionContent =
    parsedDesc.paragraphs.length > 0 || parsedDesc.features.length > 0 || parsedDesc.sections.length > 0
  // ── SEO generation — deterministic, fact-grounded ──
  // Titles/meta/JSON-LD derive from real product identity (structured fields +
  // Item Specifics parsed from the admin description). No fabricated attributes:
  // unknown values are omitted, IMPA is additionalProperty (never GTIN), and the
  // brand is asserted only when a real manufacturer/brand is known.
  const productSeo = buildProductSeo({
    id: product.id,
    slug: product.slug,
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    category: product.category,
    condition: product.condition,
    description: product.description,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    price: product.price,
    onSale: product.onSale,
    salePrice: product.salePrice,
    inStock: product.inStock,
    stockCount: product.stockCount,
    images: (product.images || []).map((img) => ({ url: img.url, alt: img.alt })),
    makeOffer: product.makeOffer,
    // Structured identity wins over description-parsed values
    manufacturer: product.manufacturer,
    modelNumber: product.modelNumber,
    mpn: product.mpn,
    impaCode: product.impaCode,
  })

  const handleAddToCart = () => {
    if (!product.inStock) return
    const before = useStore.getState().cart.find((i) => i.product.id === product.id)?.quantity ?? 0
    for (let i = 0; i < quantity; i++) addToCart(product)
    const after = useStore.getState().cart.find((i) => i.product.id === product.id)?.quantity ?? 0
    if (after <= before) return
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  const handleBuyNow = () => {
    for (let i = 0; i < quantity; i++) addToCart(product)
    navigate(lp('/checkout'))
  }

  return (
    <div className="py-8">
      <SEO
        title={productSeo.title}
        description={productSeo.metaDescription}
        canonical={`/${locale}/product/${product.slug || id}/`}
        ogImage={productSeo.ogImage}
        ogType="product"
        productPrice={productSeo.productPrice}
        productCurrency={productSeo.productCurrency}
        productAvailability={productSeo.productAvailability}
        productSku={productSeo.productSku}
        productBrand={productSeo.productBrand}
        productCategory={productSeo.productCategory}
        productCondition={productSeo.productCondition}
        ogImageAlt={productSeo.ogImageAlt}
        jsonLd={productSeo.jsonLd}
      />
      <BreadcrumbJsonLd items={[
        { name: 'Home', url: '/' },
        { name: 'Products', url: '/products' },
        { name: product.category.replace(/-/g, ' '), url: `/products?category=${product.category}` },
        { name: product.name, url: `/product/${id}` },
      ]} />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-colors mb-6 bg-transparent border-none cursor-pointer"
        >
          <ArrowLeft size={14} /> {t('product.backToCatalog')}
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 items-start">
          {/* LEFT COLUMN: Gallery */}
          <ProductImageGallery product={product} />

          {/* RIGHT COLUMN: Details */}
          <div className="space-y-6 text-left">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono mb-2">
                <Link to={lp('/shop')} className="hover:text-[var(--accent-primary)]">{t('nav.shop')}</Link>
                <span>/</span>
                <span className="capitalize">{readableCategory}</span>
              </div>
              <h1 className="font-display font-bold text-2xl lg:text-[2rem] tracking-tight text-[var(--text-primary)] leading-snug">{product.name}</h1>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="text-xs font-semibold px-2.5 py-0.5 border text-[var(--accent-primary)] border-[var(--info-border)] bg-[var(--surface)] rounded">
                  {t('product.brandPrefix', { brand: product.brand })}
                </span>
                <span className="text-xs font-mono text-[var(--text-muted)]">{t('product.skuPrefix', { sku: product.sku })}</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 border text-[var(--text-secondary)] border-[var(--border)] rounded">
                  {t('product.conditionLabel', { condition: product.condition.charAt(0).toUpperCase() + product.condition.slice(1) })}
                </span>
              </div>
            </div>

            {/* Price */}
            <div className="border-y border-[var(--border)] py-4 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                {product.onSale && product.salePrice ? (
                  <div className="flex items-center gap-3">
                    <span className="font-display font-bold text-4xl text-[var(--danger)] tabular-nums">
                      ${product.salePrice.toFixed(2)}
                    </span>
                    <span className="font-display font-bold text-xl text-[var(--text-muted)] line-through tabular-nums">
                      ${originalPrice.toFixed(2)}
                    </span>
                    <span className="text-xs font-bold bg-[var(--danger)] text-[var(--btn-danger-text)] px-2 py-0.5 rounded">
                      {t('product.percentageOff', { percent: Math.max(0, Math.round((1 - product.salePrice / originalPrice) * 100)) })}
                    </span>
                  </div>
                ) : (
                  <span className="font-display font-bold text-4xl text-[var(--accent-primary)] tabular-nums">
                    ${effectivePrice.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="text-right flex items-center gap-2">
                {product.inStock ? (
                  <>
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--success)] animate-pulse" />
                    <span className="text-xs font-mono text-[var(--text-secondary)]">
                      {t('product.stockAvailable', { count: product.stockCount })}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--danger)]" />
                    <span className="text-xs font-mono text-[var(--danger)]">{t('product.outOfStock')}</span>
                  </>
                )}
              </div>
            </div>

            {/* Item Specifics — parsed from the description blob + product fields.
                This is the categorized "Label: value" table (Brand, Model, IMPA,
                Size, Material...); it replaces the old junk spec list and the
                wall-of-text description paragraph above the buy box. */}
            {specRows.length > 0 && (
              <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-[var(--secondary-bg)] border-b border-[var(--border)] font-bold text-sm text-[var(--text-primary)] uppercase tracking-wide">
                  {t('product.itemSpecifics')}
                </div>
                <dl className="divide-y divide-[var(--border)]/60">
                  {specRows.map((row, idx) => (
                    <div key={`${row.label}-${idx}`} className="grid grid-cols-[minmax(96px,38%)_1fr]">
                      <dt className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] bg-[var(--secondary-bg)]/40 flex items-start">
                        {row.label}
                      </dt>
                      <dd className="px-4 py-2 text-xs text-[var(--text-primary)] min-w-0 break-words flex items-start">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {/* Structured specs saved in the admin form (when any exist) */}
                {product.specs && Object.keys(product.specs).length > 0 && (
                  <div className="border-t border-[var(--border)]/60">
                    {Object.entries(product.specs).map(([key, val]) => (
                      <div key={key} className="grid grid-cols-[minmax(96px,38%)_1fr]">
                        <span className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] bg-[var(--secondary-bg)]/40">{t(`product.${key}`)}</span>
                        <span className="px-4 py-2 text-xs text-[var(--text-primary)] min-w-0 break-words">{val}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Condition detail (kept from the admin form's condition field) */}
            <div className="p-4 bg-[var(--secondary-bg)] border border-[var(--border)] rounded-xl text-xs leading-relaxed">
              <span className="font-bold text-[var(--text-primary)] uppercase tracking-wide block mb-1">{t('product.condition')}</span>
              <p className="text-[var(--text-secondary)]">
                {product.condition === 'new' && t('product.conditionNew')}
                {product.condition === 'refurbished' && t('product.conditionRefurbished')}
                {product.condition === 'used' && t('product.conditionUsed')}
                {product.condition === 'reconditioned' && t('product.conditionReconditioned')}
                {product.condition === 'unused' && t('product.conditionUnused')}
              </p>
            </div>

            {/* In Stock Actions — ref for sticky mobile bar */}
            {product.inStock && (
              <div ref={ctaRef}>
                <div className="flex items-center gap-4 border border-[var(--border)] bg-[var(--secondary-bg)] p-2 rounded-xl justify-between">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] pl-2">{t('product.quantity')}</span>
                  <div className="flex items-center gap-1 bg-[var(--primary-bg)] p-0.5 rounded-full">
                    <button
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center hover:bg-[var(--border)] transition-colors border-none cursor-pointer font-bold text-[var(--text-secondary)] text-sm"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="min-w-[32px] text-center text-sm font-semibold text-[var(--text-primary)]">{quantity}</span>
                    <button
                      onClick={() => setQuantity((q) => Math.min(q + 1, Math.max(1, product.stockCount)))}
                      disabled={quantity >= Math.max(1, product.stockCount)}
                      aria-label={t('product.quantity')}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center hover:bg-[var(--border)] transition-colors border-none cursor-pointer font-bold text-[var(--text-secondary)] text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleAddToCart}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 text-xs font-semibold rounded-xl transition-all duration-300 border cursor-pointer ${
                      added
                        ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
                        : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)] hover:bg-[var(--accent-primary-hover)]'
                    }`}
                  >
                    {added ? <><Check size={14} /> {t('product.added')}</> : <><ShoppingCart size={14} /> {t('product.addToCartUpper')}</>}
                  </button>
                  <button
                    onClick={handleBuyNow}
                    className="w-full flex items-center justify-center gap-2 py-3.5 text-xs font-semibold rounded-xl bg-transparent border border-[var(--accent-primary)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-[var(--btn-blue-text)] transition-all cursor-pointer"
                  >
                    {t('product.buyNow')}
                  </button>
                </div>

                {product.makeOffer && (
                  <button
                    onClick={() => setShowOfferModal(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 border border-[var(--border)] hover:border-[var(--accent-primary)] text-[var(--accent-primary)] bg-transparent font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    <Percent size={14} /> {t('product.makeOffer')}
                  </button>
                )}
              </div>
            )}

            {/* Out of Stock */}
            {!product.inStock && (
              <div className="p-4 bg-[var(--surface-soft)] border border-[var(--border)] rounded-xl text-center">
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{t('product.outOfStockMsg')}</p>
                <p className="text-xs text-[var(--text-muted)] mb-3">{t('product.checkAvailability')}</p>
                <a
                  href={`https://wa.me/${whatsappNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-bold px-6 py-2.5 rounded-xl text-xs transition-all hover:bg-[var(--accent-primary-hover)] no-underline"
                >
                  <WhatsAppIcon size={14} /> {t('product.inquireWhatsApp')}
                </a>
              </div>
            )}

            {/* Specs — legacy: only shown when the description blob produced
                nothing (covers older products with structured specs only) */}
            {specRows.length === 0 && (
              <div className="border-t border-[var(--border)] pt-4 space-y-2.5 text-xs">
                {Object.entries(formSpecs).map(([key, val]) => (
                  <div key={key} className="grid grid-cols-[auto_1fr] border-b border-[var(--border)]/40 pb-2">
                    <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wide text-xs">
                      {t(`product.${key}`)}
                    </span>
                    <span className="text-[var(--text-primary)] min-w-0 break-words">{val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Trust badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 text-xs font-mono text-[var(--text-secondary)]">
              <div className="border border-[var(--border)] p-2 bg-[var(--secondary-bg)] text-center rounded">{t('product.topRated')}</div>
              <div className="border border-[var(--border)] p-2 bg-[var(--secondary-bg)] text-center rounded">{t('product.fedexDelivery')}</div>
              <div className="border border-[var(--border)] p-2 bg-[var(--secondary-bg)] text-center rounded">{t('product.sameDayShipping')}</div>
              <div className="border border-[var(--border)] p-2 bg-[var(--secondary-bg)] text-center rounded">{t('product.freeReturns')}</div>
            </div>
          </div>
        </div>

        {/* DESCRIPTION SECTION — categorized content blocks */}
        {hasDescriptionContent && (
          <section className="mt-16 border-t border-[var(--border)] pt-10 text-left">
            <div className="border-b border-[var(--border)] mb-6">
              <span className="inline-block border-b-2 border-[var(--accent-primary)] pb-2 font-semibold text-sm text-[var(--accent-primary)] tracking-wide uppercase">
                {t('product.description')}
              </span>
            </div>
            <div className="space-y-8 text-sm text-[var(--text-secondary)] leading-relaxed max-w-[800px]">
              {/* Free-form overview paragraphs */}
              {parsedDesc.paragraphs.length > 0 && (
                <div className="space-y-3">
                  {parsedDesc.paragraphs.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}

              {/* KEY FEATURES — bullet list with accent markers */}
              {parsedDesc.features.length > 0 && (
                <div>
                  <h3 className="heading-lg uppercase tracking-wide mb-3">{t('product.keyFeatures')}</h3>
                  <ul className="space-y-2">
                    {parsedDesc.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <Check size={14} className="text-[var(--accent-primary)] mt-0.5 shrink-0" aria-hidden />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Titled sections parsed from the blob (Condition notes, What's
                  Included, Shipping, Warranty...) */}
              {parsedDesc.sections.map((section, i) => (
                <div
                  key={`${section.key}-${i}`}
                  className="bg-[var(--secondary-bg)] border border-[var(--border)] p-5 rounded-xl"
                >
                  <h3 className="font-bold text-[var(--text-primary)] text-sm mb-2 uppercase tracking-wide">
                    {section.title || sectionTitle(section.key)}
                  </h3>
                  {section.paragraphs.length > 0 && (
                    <div className="space-y-2">
                      {section.paragraphs.map((para, j) => (
                        <p key={j}>{para}</p>
                      ))}
                    </div>
                  )}
                  {section.bullets.length > 0 && (
                    <ul className="list-disc list-inside space-y-1.5 mt-2">
                      {section.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {/* Static shipping info block (kept — it's storefront policy,
                  not product content) */}
              <div className="space-y-3 text-xs text-[var(--text-secondary)] bg-[var(--secondary-bg)] border border-[var(--border)] p-5 rounded-xl">
                <h4 className="font-bold text-[var(--text-primary)] text-sm mb-2">{t('product.shippingInfo')}</h4>
                <ul className="list-disc list-inside space-y-2">
                  <li>{t('product.shippingLine1')}</li>
                  <li>{t('product.shippingLine2')}</li>
                  <li>{t('product.shippingLine3')}</li>
                  <li>{t('product.shippingLine4')}</li>
                  <li>{t('product.shippingLine5')}</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {/* We've Got You Covered */}
        <section className="mt-16 bg-[var(--secondary-bg)] border border-[var(--border)] p-8 rounded-2xl text-center">
          <h3 className="heading-xl text-[var(--text-primary)] mb-2 uppercase">{t('product.weGotYou')}</h3>
          <p className="text-xs text-[var(--text-secondary)] max-w-[640px] mx-auto leading-relaxed mb-8">{t('product.weGotYouSub')}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { title: '30 ' + t('product.days'), desc: t('product.returnPolicy'), icon: RotateCcw },
              { title: t('product.dedicated'), desc: t('product.afterSales'), icon: MessageCircle },
              { title: t('product.sameDay'), desc: t('product.dispatchGuarantee'), icon: Truck },
              { title: t('product.allUnits'), desc: t('product.fullyTested'), icon: ShieldCheck },
            ] as const).map((item, idx) => {
              const Icon = item.icon
              return (
                <div key={idx} className="bg-[var(--primary-bg)] border border-[var(--border)] p-4 rounded-xl flex flex-col items-center">
                  <Icon className="text-[var(--accent-primary)] mb-2.5" size={24} />
                  <span className="text-xs font-bold text-[var(--text-primary)] block">{item.title}</span>
                  <span className="text-xs text-[var(--text-muted)]">{item.desc}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* RELATED PRODUCTS */}
        <RelatedProducts products={related} />
      </div>

      {/* OFFER MODAL */}
      {showOfferModal && product.makeOffer && (
        <OfferModal product={product} onClose={() => setShowOfferModal(false)} />
      )}

      {/* ── Sticky mobile add-to-cart bar ── */}
      {product.inStock && (
        <div
          className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden border-t border-[var(--header-border)] bg-[var(--surface)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-4px_20px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-in-out ${
            showStickyBar ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ willChange: 'transform' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{product.name}</p>
              <p className="text-sm font-bold text-[var(--accent-primary)] tabular-nums">
                ${effectivePrice.toFixed(2)}
              </p>
            </div>
            <button
              onClick={handleAddToCart}
              className={`flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] text-xs font-semibold rounded-xl transition-all duration-300 border cursor-pointer whitespace-nowrap ${
                added
                  ? 'border-[var(--success)] bg-[var(--success)] text-[var(--btn-success-text)]'
                  : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--btn-blue-text)] hover:bg-[var(--accent-primary-hover)]'
              }`}
            >
              {added ? <><Check size={14} /> {t('product.added')}</> : <><ShoppingCart size={14} /> {t('product.addToCartUpper')}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
