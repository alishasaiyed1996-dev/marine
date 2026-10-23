import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowRight, Truck, ShieldCheck, Clock, Package } from 'lucide-react'
import { apiProductsToFrontend } from '../lib/adapters'
import { useAddToCart } from '../hooks/useAddToCart'
import { useNewArrivals, useFeaturedProducts, useCategories, useProductList } from '../hooks/useApiQuery'
import { SectionLabel } from '../components/ui/SectionLabel'
import { ProductCard } from '../components/ui/ProductCard'
import { CatalogOfflineNotice } from '../components/ui/CatalogOfflineNotice'
import { ProductCardSkeleton } from '../components/ui/Skeleton'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { buildShippingPromise } from '../lib/shippingPromise'
import type { Product } from '../types'

interface CategoryWithCount {
  id: string
  name: string
  icon: string
  count: number
}

export default function Shop() {
  const { t } = useTranslation()
  const { handleAddToCart, addedIds } = useAddToCart()
  const settings = useStoreSettings()
  // The hero's shipping promise must match what checkout actually charges.
  const shippingPromise = useMemo(
    () => buildShippingPromise({
      zones: settings.shippingZones,
      freeShippingThreshold: settings.freeShippingThreshold,
      currency: settings.currency,
    }, t),
    [settings.shippingZones, settings.freeShippingThreshold, settings.currency, t],
  )

  // React Query provides caching, deduplication, and background refetching
  const newArrivalsQuery = useNewArrivals()
  const featuredQuery = useFeaturedProducts()
  const latestQuery = useProductList({ limit: '8', sort: 'newest' })
  const categoriesQuery = useCategories()

  const { data: newArrivalsData } = newArrivalsQuery
  const { data: featuredData } = featuredQuery
  const { data: latestData } = latestQuery
  const { data: categoriesData } = categoriesQuery

  // Any failed catalog query means the grids below are showing the bundled
  // demo catalog (or empty sections) — surface that instead of failing silently.
  const catalogError = newArrivalsQuery.isError || featuredQuery.isError || latestQuery.isError || categoriesQuery.isError
  const retryCatalog = () => {
    if (newArrivalsQuery.isError) newArrivalsQuery.refetch()
    if (featuredQuery.isError) featuredQuery.refetch()
    if (latestQuery.isError) latestQuery.refetch()
    if (categoriesQuery.isError) categoriesQuery.refetch()
  }

  const newArrivals: Product[] = useMemo(
    () => (newArrivalsData?.products?.length ? apiProductsToFrontend(newArrivalsData.products).slice(0, 8) : []),
    [newArrivalsData],
  )

  const featuredProducts: Product[] = useMemo(
    () => (featuredData?.products?.length ? apiProductsToFrontend(featuredData.products).slice(0, 8) : []),
    [featuredData],
  )

  // Latest published catalog items — guarantees every published product can
  // surface on the shop page even when it is neither featured nor flagged as
  // a new arrival. Empty on API failure: the notice above explains, and
  // bundled sample products are never shown as if they were real stock.
  const latestProducts: Product[] = useMemo(
    () => (latestData?.products?.length ? apiProductsToFrontend(latestData.products).slice(0, 8) : []),
    [latestData],
  )

  const categories: CategoryWithCount[] = useMemo(() => {
    if (!categoriesData?.categories?.length) return []
    return categoriesData.categories.map((c: any) => ({
      id: c.slug || c.id,
      name: c.name,
      icon: c.icon || 'Package',
      count: c._count?.products ?? c.productCount ?? 0,
    }))
  }, [categoriesData])



  return (
    <div>
      <SEO
        title="Shop — Marine & Industrial Equipment"
        description="Browse our catalog of marine spares, ship machinery, surplus equipment, hydraulics, pneumatics, and electrical automation components."
        canonical="/products/"
      />
      <BreadcrumbJsonLd items={[{ name: 'Home', url: '/' }, { name: 'Products', url: '/products/' }]} />
      {catalogError && (
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-6">
          <CatalogOfflineNotice onRetry={retryCatalog} retrying={newArrivalsQuery.isFetching || featuredQuery.isFetching || latestQuery.isFetching || categoriesQuery.isFetching} />
        </div>
      )}
      {/* ── SHOP HERO ── */}
      <section className="relative overflow-hidden bg-[var(--navy-deep)] py-16 border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,var(--gold-muted),transparent_28rem),radial-gradient(circle_at_85%_20%,var(--teal-soft),transparent_30rem)]" />
        <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="max-w-[640px] text-white">
              {/* The hero sits on an always-dark navy background, so all text
                  must be light in BOTH themes (--accent-gold is too dark in
                  light mode, hence the gold-light override on the label). */}
              <SectionLabel style={{ color: 'var(--gold-light)' }}>{t('shop.categories')}</SectionLabel>
              <h1 className="font-display font-bold text-display-xl tracking-tight mt-2 text-white">
                {t('shop.title')}
              </h1>
              <p className="mt-4 text-body text-white/70">
                {t('shop.sub')}
              </p>
              <div className="flex flex-wrap gap-6 mt-8">
                {[
                  { icon: Truck, label: t('shop.freeShipping'), sub: shippingPromise.label },
                  { icon: Clock, label: t('shop.timelyDelivery'), sub: t('shop.timelyDeliverySub') },
                  { icon: ShieldCheck, label: t('shop.securePayment'), sub: t('shop.securePaymentSub') },
                  { icon: Package, label: t('shop.easyReturns'), sub: t('shop.easyReturnsSub') },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                        <Icon size={20} className="text-[var(--gold-light)]" />
                      </div>
                      <div>
                        <span className="block text-xs font-bold text-white">{item.label}</span>
                        <span className="text-xs text-white/70">{item.sub}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="hidden lg:block">
              <Link
                to="/products"
                className="inline-flex items-center gap-2 text-sm font-bold bg-[var(--accent-primary)] text-[var(--btn-blue-text)] border-2 border-[var(--accent-primary)] px-6 py-3 rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all duration-300 no-underline"
              >
                {t('shop.viewFullCatalog')} <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CATEGORIES GRID ── */}
      <section className="py-16 marine-section">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <SectionLabel>{t('shop.categories')}</SectionLabel>
          <h2 className="font-display font-bold text-section tracking-tight text-[var(--text-primary)] mt-2">
            {t('shop.shopByCategory')}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-8">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                to={`/products?category=${cat.id}`}
                className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent-primary)] hover:shadow-md transition-all duration-300 no-underline"
              >
                <span className="text-xs font-bold text-center text-[var(--text-primary)] group-hover:text-[var(--accent-gold)] transition-colors leading-tight">
                  {cat.name}
                </span>                  <span className="text-caption text-[var(--text-muted)]">{cat.count} {t('shop.items')}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── NEW ARRIVALS ── */}
      <section className="py-16 bg-[var(--secondary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <SectionLabel>{t('shop.newArrivals')}</SectionLabel>
              <h2 className="font-display font-bold text-section tracking-tight text-[var(--text-primary)] mt-2">
                {t('shop.justAdded')}
              </h2>
            </div>
            <Link
              to="/products"
              className="hidden sm:inline-flex items-center gap-2 text-sm font-bold text-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-colors no-underline"
            >
              {t('shop.viewAll')} <ArrowRight size={16} />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {newArrivalsQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={`na-skel-${i}`} />)
            ) : newArrivals.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                added={addedIds.has(product.id)}
                onAddToCart={handleAddToCart}
                t={t}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURED PRODUCTS ── */}
      <section className="py-16 bg-[var(--primary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <SectionLabel>{t('shop.featured')}</SectionLabel>
              <h2 className="font-display font-bold text-section tracking-tight text-[var(--text-primary)] mt-2">
                {t('shop.popularProducts')}
              </h2>
            </div>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 text-sm font-bold border-2 border-[var(--accent-primary)] text-[var(--accent-primary)] px-5 py-2.5 rounded-xl hover:bg-[var(--accent-primary)] hover:text-[var(--btn-blue-text)] transition-all duration-300 no-underline"
            >
              {t('shop.fullCatalog')} <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {featuredQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={`feat-skel-${i}`} />)
            ) : featuredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  added={addedIds.has(product.id)}
                  onAddToCart={handleAddToCart}
                  t={t}
                />
            ))}
          </div>
        </div>
      </section>

      {/* ── LATEST PRODUCTS ── */}
      <section className="py-16 bg-[var(--secondary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <SectionLabel>{t('shop.latestProducts')}</SectionLabel>
              <h2 className="font-display font-bold text-section tracking-tight text-[var(--text-primary)] mt-2">
                {t('shop.freshInventory')}
              </h2>
            </div>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 text-sm font-bold border-2 border-[var(--accent-primary)] text-[var(--accent-primary)] px-5 py-2.5 rounded-xl hover:bg-[var(--accent-primary)] hover:text-[var(--btn-blue-text)] transition-all duration-300 no-underline"
            >
              {t('shop.fullCatalog')} <ArrowRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {latestQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={`latest-skel-${i}`} />)
            ) : latestProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                added={addedIds.has(product.id)}
                onAddToCart={handleAddToCart}
                t={t}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-16 bg-[var(--secondary-bg)]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="rounded-2xl bg-gradient-to-br from-[var(--navy-deep)] to-[var(--navy-mid)] p-8 md:p-12 text-center text-white">
            {/* text-section sets its own color; override it explicitly since
                this banner is always dark navy in both themes. */}
            <h2 className="font-display font-bold text-section mb-3 text-white">
              {t('shop.cantFind')}
            </h2>
            <p className="text-white/70 max-w-[560px] mx-auto mb-6 text-sm">
              {t('shop.submitRfqDesc')}
            </p>
            <Link
              to="/rfq"
              className="inline-flex items-center gap-2 bg-[var(--accent-primary)] text-[var(--btn-blue-text)] font-bold px-8 py-3.5 rounded-xl hover:bg-[var(--accent-primary-hover)] transition-all no-underline"
            >
              {t('shop.submitRfq')} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
