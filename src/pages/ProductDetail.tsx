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
import { isUuidSku } from '../lib/description'
import { buildProductSeo } from '../lib/seo/productSeo'
import { ProductImageGallery } from '../components/product/ProductImageGallery'
import { OfferModal } from '../components/product/OfferModal'
import { Skeleton } from '../components/ui/Skeleton'
import { RelatedProducts } from '../components/product/RelatedProducts'
import { useLocalizedPath, useLocale } from '../lib/locale'
import { formatMoney } from '../lib/utils'

export default function ProductDetail() {
  const { t } = useTranslation()
  const { key } = useParams()
  const id = key
  const locale = useLocale()
  const lp = useLocalizedPath()
  const navigate = useNavigate()
  const { addToCart } = useStore()
  const { whatsappNumber, currency: storeCurrency } = useStoreSettings()

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

  // The sticky mobile add-to-cart bar is position:fixed, so at max scroll it
  // permanently covers the bottom of the document (footer links). In-flow
  // spacers inside the page can't help — the footer renders after this
  // component. Append real scrollable clearance to the END of <body> instead,
  // sized to clear the bar (~68px) plus its safe-area padding.
  useEffect(() => {
    if (!product?.inStock) return
    const spacer = document.createElement('div')
    spacer.setAttribute('aria-hidden', 'true')
    spacer.style.height = '6rem'
    spacer.style.height = 'calc(6rem + env(safe-area-inset-bottom, 0px))'
    // No sticky bar on desktop
    spacer.style.display = 'none'
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => { spacer.style.display = mq.matches ? 'none' : 'block' }
    sync()
    mq.addEventListener('change', sync)
    document.body.appendChild(spacer)
    return () => {
      mq.removeEventListener('change', sync)
      spacer.remove()
    }
  }, [product?.inStock])

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
        <h1 className="text-2xl font-bold mb-2">{t('product.productNotFound')}</h1>
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

  // ── Generated page model ──────────────────────────────────────
  // ONE shared engine builds the title, meta description, H1, specs, sections,
  // FAQs and JSON-LD. The same module runs in the prerenderer and the Express
  // server, so crawlers and visitors always see identical facts.
  const productSeo = buildProductSeo(
    {
      id: product.id,
      slug: product.slug,
      name: product.name,
      sku: product.sku,
      brand: product.brand,
      category: product.category,
      categoryName: product.categoryName,
      categoryVisible: product.categoryVisible,
      condition: product.condition,
      description: product.description,
      shortDescription: product.shortDescription,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      price: product.price,
      regularPrice: product.regularPrice,
      salePrice: product.salePrice,
      currency: product.currency,
      onSale: product.onSale,
      inStock: product.inStock,
      stockCount: product.stockCount,
      images: (product.images || []).map((img) => ({ url: img.url, alt: img.alt })),
      ogImageUrl: product.ogImageUrl,
      makeOffer: product.makeOffer,
      // Structured identity wins over description-parsed values
      manufacturer: product.manufacturer,
      modelNumber: product.modelNumber,
      mpn: product.mpn,
      gtin: product.gtin,
      impaCode: product.impaCode,
      specs: product.specs,
      // Rich listing facts. Unknown values stay absent instead of becoming
      // "N/A" rows or invented compatibility claims.
      keyFeatures: product.keyFeatures,
      compatibilityNotes: product.compatibilityNotes,
      conditionNotes: product.conditionNotes,
      warrantyNotes: product.warrantyNotes,
      includedItems: product.includedItems,
      excludedItems: product.excludedItems,
      leadTime: product.leadTime,
      publicItemLocation: product.publicItemLocation,
      lastVerifiedAt: product.lastVerifiedAt,
      industries: (product.industryNames || []).map((name) => ({ name })),
    },
    { locale, related },
  )
  const page = productSeo.page
  const specRows = page.specs
  const readableCategory = page.category.name || product.category.replace(/-/g, ' ')
  // Hidden category/brand hubs return 404, so never link to them from a live
  // product page. The names still render as plain text.
  const categoryLinkVisible = page.category.visible
  const overview = page.overview[0] || product.shortDescription || ''
  // "Overview" is the lead paragraph above the buy box; every other generated
  // section is rendered in the long-form product content below.
  const contentSections = page.sections.filter((section) => section.id !== 'overview')
  const hasDescriptionContent = contentSections.length > 0
  const conditionDetail =
    product.conditionNotes && product.conditionNotes.trim().length > 12
      ? product.conditionNotes.trim()
      : null

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
        canonical={page.canonicalPath}
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
      <BreadcrumbJsonLd items={page.breadcrumbs.map((crumb) => ({ name: crumb.name, url: crumb.path }))} />
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
          <div className="space-y-6 text-start">
            <div>
              <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)] font-mono mb-2">
                <Link to={lp('/')} className="hover:text-[var(--accent-primary)]">{t('nav.home')}</Link>
                <span aria-hidden="true">/</span>
                <Link to={lp('/products')} className="hover:text-[var(--accent-primary)]">{t('nav.products')}</Link>
                <span aria-hidden="true">/</span>
                {categoryLinkVisible ? (
                  <Link to={lp(`/categories/${product.category}`)} className="capitalize hover:text-[var(--accent-primary)]">{readableCategory}</Link>
                ) : (
                  <span className="capitalize">{readableCategory}</span>
                )}
              </nav>
              {/* H1 mirrors the fact-grounded schema name so the visible
                  heading and Product JSON-LD agree (Google checks this). */}
              <h1 className="font-display font-bold text-2xl lg:text-[2rem] tracking-tight text-[var(--text-primary)] leading-snug">{productSeo.h1 || product.name}</h1>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                {product.brandSlug ? (
                  <Link to={lp(`/brands/${product.brandSlug}`)} className="text-xs font-semibold px-2.5 py-0.5 border text-[var(--accent-primary)] border-[var(--info-border)] bg-[var(--surface)] rounded no-underline hover:underline">
                    {t('product.brandPrefix', { brand: product.brand })}
                  </Link>
                ) : (
                  <span className="text-xs font-semibold px-2.5 py-0.5 border text-[var(--accent-primary)] border-[var(--info-border)] bg-[var(--surface)] rounded">
                    {t('product.brandPrefix', { brand: product.brand })}
                  </span>
                )}
                {!isUuidSku(product.sku) && (
                  <span className="text-xs font-mono text-[var(--text-muted)]">{t('product.skuPrefix', { sku: product.sku })}</span>
                )}
                <span className="text-xs font-semibold px-2.5 py-0.5 border text-[var(--text-secondary)] border-[var(--border)] rounded">
                  {t('product.conditionLabel', { condition: product.condition.charAt(0).toUpperCase() + product.condition.slice(1) })}
                </span>
                {product.modelNumber && (
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    {t('product.modelPrefix', { model: product.modelNumber, defaultValue: `Model: ${product.modelNumber}` })}
                  </span>
                )}
                {product.mpn && product.mpn !== product.modelNumber && (
                  <span className="text-xs font-mono text-[var(--text-muted)]">
                    {t('product.mpnPrefix', { mpn: product.mpn, defaultValue: `MPN: ${product.mpn}` })}
                  </span>
                )}
              </div>
              {overview && (
                <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)] max-w-[62ch]">
                  {overview}
                </p>
              )}
            </div>

            {/* Price */}
            <div className="border-y border-[var(--border)] py-4 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                {product.onSale && product.salePrice ? (
                  <div className="flex items-center gap-3">
                    <span className="font-display font-bold text-4xl text-[var(--danger)] tabular-nums">
                      {formatMoney(product.salePrice, product.currency || storeCurrency)}
                    </span>
                    <span className="font-display font-bold text-xl text-[var(--text-muted)] line-through tabular-nums">
                      {formatMoney(originalPrice, product.currency || storeCurrency)}
                    </span>
                    <span className="text-xs font-bold bg-[var(--danger)] text-[var(--btn-danger-text)] px-2 py-0.5 rounded">
                      {t('product.percentageOff', { percent: Math.max(0, Math.round((1 - product.salePrice / originalPrice) * 100)) })}
                    </span>
                  </div>
                ) : (
                  <span className="font-display font-bold text-4xl text-[var(--accent-primary)] tabular-nums">
                    {formatMoney(effectivePrice, product.currency || storeCurrency)}
                  </span>
                )}
              </div>
              <div className="text-end flex items-center gap-2">
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

            {/* Condition detail (kept from the admin form's condition field) */}
            <div className="p-4 bg-[var(--secondary-bg)] border border-[var(--border)] rounded-xl text-xs leading-relaxed">
              <span className="font-bold text-[var(--text-primary)] uppercase tracking-wide block mb-1">{t('product.condition')}</span>
              <p className="text-[var(--text-secondary)]">
                {conditionDetail ||
                  (product.condition === 'new' && t('product.conditionNew')) ||
                  (product.condition === 'refurbished' && t('product.conditionRefurbished')) ||
                  (product.condition === 'used' && t('product.conditionUsed')) ||
                  (product.condition === 'reconditioned' && t('product.conditionReconditioned')) ||
                  (product.condition === 'unused' && t('product.conditionUnused'))}
              </p>
            </div>

            {/* In Stock Actions — ref for sticky mobile bar */}
            {product.inStock && (
              <div ref={ctaRef}>
                <div className="flex items-center gap-4 border border-[var(--border)] bg-[var(--secondary-bg)] p-2 rounded-xl justify-between">
                  <span className="text-xs font-semibold text-[var(--text-secondary)] ps-2">{t('product.quantity')}</span>
                  <div className="flex items-center gap-1 bg-[var(--primary-bg)] p-0.5 rounded-full">
                    <button
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      aria-label={t('a11y.decreaseQuantity')}
                      className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center hover:bg-[var(--border)] transition-colors border-none cursor-pointer font-bold text-[var(--text-secondary)] text-sm"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="min-w-[32px] text-center text-sm font-semibold text-[var(--text-primary)]">{quantity}</span>
                    <button
                      onClick={() => setQuantity((q) => Math.min(q + 1, Math.max(1, product.stockCount)))}
                      disabled={quantity >= Math.max(1, product.stockCount)}
                      aria-label={t('a11y.increaseQuantity')}
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

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--text-muted)]">
                  <span>{t('product.needQuantity', { defaultValue: 'Need a different quantity?' })}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I have a question about ${product.name}${isUuidSku(product.sku) ? '' : ` (SKU ${product.sku})`}.`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[var(--accent-primary)] no-underline hover:underline"
                    >
                      <WhatsAppIcon size={12} /> {t('product.askQuestion', { defaultValue: 'Ask about this part' })}
                    </a>
                    <Link
                      to={lp('/rfq')}
                      className="font-semibold text-[var(--accent-primary)] no-underline hover:underline"
                    >
                      {t('product.requestQuote', { defaultValue: 'Request a quote' })}
                    </Link>
                  </div>
                </div>
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

            {/* Item Specifics — one de-duplicated table built from curated
                specs, parsed description rows and identity fallbacks. It sits
                below the buy box so price and CTA stay above the fold. */}
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

        {/* LONG-FORM CONTENT — generated once by shared/product-page.mjs.
            Every paragraph is fact-grounded in the listing; unknown attributes
            are omitted instead of padded with generic claims. */}
        {hasDescriptionContent && (
          <section
            aria-labelledby="product-details-heading"
            className="mt-16 border-t border-[var(--border)] pt-10 text-start"
          >
            <div className="border-b border-[var(--border)] mb-6">
              <h2
                id="product-details-heading"
                className="inline-block border-b-2 border-[var(--accent-primary)] pb-2 font-semibold text-sm text-[var(--accent-primary)] tracking-wide uppercase"
              >
                {t('product.description')}
              </h2>
            </div>
            <div className="space-y-8 text-sm text-[var(--text-secondary)] leading-relaxed max-w-[820px]">
              {contentSections.map((section) => (
                <section
                  key={section.id}
                  id={`product-${section.id}`}
                  className="bg-[var(--secondary-bg)] border border-[var(--border)] p-5 rounded-xl"
                >
                  <h3 className="font-bold text-[var(--text-primary)] text-sm mb-3 uppercase tracking-wide">
                    {section.title}
                  </h3>
                  {section.paragraphs.length > 0 && (
                    <div className="space-y-2.5">
                      {section.paragraphs.map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                  {section.bullets.length > 0 && (
                    <ul className={section.id === 'features' ? 'space-y-2' : 'list-disc list-inside space-y-1.5'}>
                      {section.bullets.map((bullet, index) => (
                        <li key={index} className={section.id === 'features' ? 'flex items-start gap-2.5' : undefined}>
                          {section.id === 'features' && (
                            <Check size={14} className="text-[var(--accent-primary)] mt-0.5 shrink-0" aria-hidden />
                          )}
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </section>
        )}

        {/* PRODUCT FAQs — visible answers match the FAQPage JSON-LD exactly.
            Native <details> keeps the copy in the DOM for crawlers while
            letting human visitors expand only what they need. */}
        {page.faqs.length > 0 && (
          <section
            aria-labelledby="product-faq-heading"
            className="mt-16 border-t border-[var(--border)] pt-10 text-start"
          >
            <h2
              id="product-faq-heading"
              className="inline-block border-b-2 border-[var(--accent-primary)] pb-2 font-semibold text-sm text-[var(--accent-primary)] tracking-wide uppercase mb-6"
            >
              Frequently asked questions
            </h2>
            <div className="max-w-[820px] divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {page.faqs.map((faq, index) => (
                <details key={faq.question} className="group py-4" open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-[var(--text-primary)] marker:hidden">
                    <span>{faq.question}</span>
                    <Plus
                      size={16}
                      aria-hidden
                      className="mt-0.5 shrink-0 text-[var(--accent-primary)] transition-transform group-open:rotate-45"
                    />
                  </summary>
                  <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-secondary)]">{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* We've Got You Covered */}
        <section className="mt-16 bg-[var(--secondary-bg)] border border-[var(--border)] p-8 rounded-2xl text-center">
          <h2 className="heading-xl text-[var(--text-primary)] mb-2 uppercase">{t('product.weGotYou')}</h2>
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

        {/* Internal link graph: product → category hub → brand hub → catalog.
            These crawlable backlinks are what distribute authority from each
            product page into the hub pages that can rank for broader terms. */}
        <nav aria-label="Related catalog pages" className="mt-12 flex flex-wrap gap-3 border-t border-[var(--border)] pt-8 text-sm">
          {categoryLinkVisible && (
            <Link to={lp(`/categories/${product.category}`)} className="rounded-full border border-[var(--border)] px-4 py-2 font-semibold text-[var(--text-primary)] no-underline hover:border-[var(--accent-primary)]">
              More {readableCategory} parts
            </Link>
          )}
          {product.brandSlug && (
            <Link to={lp(`/brands/${product.brandSlug}`)} className="rounded-full border border-[var(--border)] px-4 py-2 font-semibold text-[var(--text-primary)] no-underline hover:border-[var(--accent-primary)]">
              More {product.brand} parts
            </Link>
          )}
          <Link to={lp('/products')} className="rounded-full border border-[var(--border)] px-4 py-2 font-semibold text-[var(--text-primary)] no-underline hover:border-[var(--accent-primary)]">
            Browse all products
          </Link>
          <Link to={lp('/rfq')} className="rounded-full border border-[var(--accent-primary)] px-4 py-2 font-semibold text-[var(--accent-primary)] no-underline hover:bg-[var(--accent-primary)] hover:text-[var(--btn-blue-text)]">
            {t('product.requestQuote', { defaultValue: 'Request a quote' })}
          </Link>
        </nav>

        {/* Crawlable related-part references. These text links complement the
            photo cards below and expose sibling part numbers to search engines. */}
        {page.related.length > 0 && (
          <nav
            aria-labelledby="related-part-numbers"
            className="mt-12 rounded-2xl border border-[var(--border)] bg-[var(--secondary-bg)] p-6 text-start"
          >
            <h2 id="related-part-numbers" className="font-display text-lg font-bold text-[var(--text-primary)]">
              Related part numbers
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Compare these listings against the numbers on your equipment or parts manual.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {page.related.map((item) => (
                <li key={item.slug} className="text-sm">
                  <Link to={lp(`/product/${item.slug}`)} className="font-semibold text-[var(--accent-primary)] no-underline hover:underline">
                    {item.name}
                  </Link>
                  {(item.model || item.sku) && (
                    <span className="ms-2 font-mono text-xs text-[var(--text-muted)]">
                      {item.model || item.sku}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}

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
                {formatMoney(effectivePrice, product.currency || storeCurrency)}
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
