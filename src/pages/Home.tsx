import { Link } from 'react-router-dom'
import { lazy, Suspense, useMemo } from 'react'
import { Anchor, ArrowRight, Clock, Cog, Droplets, Package, Search, ShieldCheck, Truck, Wrench, Zap } from 'lucide-react'
import { WhatsAppIcon } from '../components/ui/WhatsAppIcon'
import { useTranslation } from 'react-i18next'
import { useAddToCart } from '../hooks/useAddToCart'
import { useLocalizedPath } from '../lib/locale'
import { buildShippingPromise } from '../lib/shippingPromise'
import { SEO } from '../components/seo/SEO'
import { useStaticPageSeo } from '../lib/seo/staticPageSeo'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { useNewArrivals } from '../hooks/useApiQuery'
import { apiProductsToFrontend } from '../lib/adapters'
import { Hero } from '../components/sections/Hero'
import { ShopByCategory } from '../components/sections/ShopByCategory'
const StatsBar = lazy(() => import('../components/sections/StatsBar').then(m => ({ default: m.StatsBar })))
const HowItWorks = lazy(() => import('../components/sections/HowItWorks').then(m => ({ default: m.HowItWorks })))
const IndustriesTabs = lazy(() => import('../components/sections/IndustriesTabs').then(m => ({ default: m.IndustriesTabs })))
const BrandsMarquee = lazy(() => import('../components/sections/BrandsMarquee').then(m => ({ default: m.BrandsMarquee })))
const RFQSection = lazy(() => import('../components/sections/RFQSection').then(m => ({ default: m.RFQSection })))
const Testimonials = lazy(() => import('../components/sections/Testimonials').then(m => ({ default: m.Testimonials })))
import { SectionLabel } from '../components/ui/SectionLabel'
import { ProductCard } from '../components/ui/ProductCard'
import { CatalogOfflineNotice } from '../components/ui/CatalogOfflineNotice'
import { ProductCardSkeleton } from '../components/ui/Skeleton'

const ecommerceCategories = [
  { icon: Anchor, label: 'Ship Spares', href: '/products?search=ship%20spares', copy: 'Deck, engine room, bridge, and vessel maintenance parts.' },
  { icon: Cog, label: 'Marine Engine Parts', href: '/products?category=engine-spare', copy: 'Pistons, injectors, turbochargers, gaskets, and sensors.' },
  { icon: Droplets, label: 'Marine Pumps', href: '/products?category=marine-pumps', copy: 'Bilge pumps, ballast pumps, seawater pumps, and impellers.' },
  { icon: Zap, label: 'Electrical Automation', href: '/products?category=electrical', copy: 'PLC modules, VFD drives, relays, breakers, and control panels.' },
  { icon: Wrench, label: 'Hydraulic Spares', href: '/products?category=hydraulic', copy: 'Hydraulic pumps, motors, valves, cylinders, and power units.' },
  { icon: Package, label: 'Surplus Industrial Parts', href: '/products?search=surplus%20industrial%20equipment', copy: 'New old stock, used, refurbished, and tested MRO equipment.' },
]

const highIntentSearches = [
  'marine spare parts supplier',
  'ship spares online',
  'marine engine spare parts',
  'ship machinery parts',
  'marine hydraulic pump',
  'marine electrical equipment',
  'navigation equipment spares',
  'Alang ship spare parts',
  'surplus industrial equipment',
  'ABB Siemens Parker Bosch Rexroth spares',
]

export default function Home() {
  const { t } = useTranslation()
  const lp = useLocalizedPath()
  // The home page is a static route too: its fallback metadata must come from
  // the same shared manifest as the prerendered HTML and the server shell
  // (S-4/D-8). Admin-configured SEO settings may still override it.
  const staticSeo = useStaticPageSeo('')
  const { handleAddToCart, addedIds } = useAddToCart()
  const settings = useStoreSettings()
  const { whatsappNumber, seoTitle, seoDescription } = settings

  // The shipping badge must match what the checkout actually charges.
  const shippingPromise = useMemo(
    () => buildShippingPromise({
      zones: settings.shippingZones,
      freeShippingThreshold: settings.freeShippingThreshold,
      currency: settings.currency,
    }, t),
    [settings.shippingZones, settings.freeShippingThreshold, settings.currency, t],
  )

  // Fetch new arrivals from backend API; fall back to static data if backend is unavailable
  const newArrivalsQuery = useNewArrivals()
  const { data: newArrivalsData, isError: newArrivalsError } = newArrivalsQuery

  const apiNewArrivals = newArrivalsData?.products ? apiProductsToFrontend(newArrivalsData.products) : null

  // API only: if the backend is unreachable the section renders empty with
  // the outage notice above it — bundled demo products are never shown as
  // if they were real stock.
  const displayProducts = apiNewArrivals?.slice(0, 8) ?? []

  return (
    <>
      <SEO
        title={seoTitle || staticSeo.title}
        description={seoDescription || staticSeo.description}
        canonical="/en/"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Alka Traders',
            url: 'https://alkatraders.co/en/',
            potentialAction: {
              '@type': 'SearchAction',
              target: 'https://alkatraders.co/en/products/?search={search_term_string}',
              'query-input': 'required name=search_term_string',
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: 'Marine Spare Parts Online Store',
            description: 'Ecommerce storefront for ship spares, marine equipment, engine spare parts, hydraulic systems, electrical automation, navigation spares, safety gear, rigging, and industrial surplus parts.',
            url: 'https://alkatraders.co/en/',
            about: highIntentSearches,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: 'What marine spare parts and ship spares does Alka Traders supply?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Alka Traders supplies ship spares, marine engine spare parts, ship machinery parts, hydraulic pumps and motors, marine electrical equipment, automation spares, navigation equipment, marine pumps, rigging, lifting gear, safety equipment, and surplus industrial machinery.',
                },
              },
              {
                '@type': 'Question',
                name: 'Where are Alka Traders marine spare parts shipped from?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Most marine spare parts and ship spares orders are coordinated from Bhavnagar, Gujarat, India, near the Alang ship spare parts and marine equipment market, with courier, air freight, and sea freight options.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can I request a quote with only a part number or nameplate photo?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes. Buyers can send a part number, maker name, model, serial plate photo, or product description through the RFQ form, email, or WhatsApp.',
                },
              },
            ],
          },
        ]}
      />
      <Hero />

      <ShopByCategory />

      <section className="section-y-sm bg-[var(--secondary-bg)]" aria-label="Shop marine spare parts">
        <div className="site-container">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center">
            <div className="section-header mb-0">
              <SectionLabel>Online marine parts store</SectionLabel>
              <h2 className="font-display text-section-lg font-bold tracking-tight text-[var(--text-primary)]">
                Buy ship spares by category, brand, part number, or equipment type.
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
                Find marine spare parts online for vessel repair, shipyard maintenance, offshore procurement, and industrial MRO. Browse stock or send an RFQ for hard-to-find OEM and compatible replacement parts.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link to={lp('/products')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-sm font-black text-[var(--btn-blue-text)] no-underline hover:bg-[var(--accent-primary-hover)] hover:text-[var(--btn-blue-text)]">
                  <Search size={16} /> Search all products
                </Link>
                <Link to={lp('/rfq')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-black text-[var(--text-primary)] no-underline hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]">
                  Request a quote <ArrowRight size={16} />
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ecommerceCategories.map((cat) => {
                const Icon = cat.icon
                return (
                  <Link key={cat.label} to={lp(cat.href)} className="group flex min-h-[132px] gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-[var(--accent-primary)]">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--teal-soft)] text-[var(--accent-primary)]">
                      <Icon size={21} />
                    </span>
                    <span>
                      <strong className="block text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">{cat.label}</strong>
                      <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">{cat.copy}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {highIntentSearches.map((term) => (
              <Link
                key={term}
                to={lp(`/products?search=${encodeURIComponent(term)}`)}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] no-underline transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── SHIPPING BADGES ── */}
      <section className="section-y-sm bg-[var(--primary-bg)] border-y border-[var(--border)]" aria-label="Shipping and service guarantees">
        <div className="site-container">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Truck, label: shippingPromise.label, desc: shippingPromise.sub },
              { icon: Clock, label: t('topbar.timelyDelivery'), desc: t('topbar.timelyDeliverySub') },
              { icon: ShieldCheck, label: t('topbar.securePayment'), desc: t('topbar.securePaymentSub') },
              { icon: Package, label: t('topbar.easyReturns'), desc: t('topbar.easyReturnsSub') },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="flex min-h-[104px] items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[var(--shadow-card)]">
                  <div className="w-10 h-10 rounded-lg bg-[var(--teal-soft)] flex items-center justify-center flex-shrink-0">
                    <Icon size={20} className="text-[var(--accent-primary)]" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold text-[var(--text-primary)]">{item.label}</span>
                    <span className="text-xs text-[var(--text-muted)]">{item.desc}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── NEW ARRIVALS ── */}
      <section className="section-y marine-section" aria-labelledby="new-arrivals-heading">
        <div className="site-container">
          <div className="mb-6 flex flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] md:flex-row md:items-end md:justify-between md:p-8">
            <div>
              <SectionLabel>{t('shop.newArrivals')}</SectionLabel>
              <h2 id="new-arrivals-heading" className="font-display font-bold text-section tracking-tight text-[var(--text-primary)]">
                Featured marine spare parts and ship spares in stock
              </h2>
              <p className="mt-3 max-w-[620px] text-sm leading-relaxed text-[var(--text-secondary)]">
                Shop recently listed marine parts, tested surplus machinery, hydraulic spares, electrical automation components, engine spares, and hard-to-find MRO equipment.
              </p>
              <div className="gold-accent-bar mt-4" />
            </div>
            <Link
              to={lp('/products')}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--accent-primary)] bg-[var(--accent-primary)] px-6 py-3 text-sm font-bold text-[var(--btn-blue-text)] no-underline shadow-[0_8px_24px_var(--focus-ring)] transition-all duration-300 hover:bg-[var(--accent-primary-hover)] hover:text-[var(--btn-blue-text)]"
            >
              {t('shop.cta')} <ArrowRight size={16} />
            </Link>
          </div>
          {newArrivalsError && (
            <CatalogOfflineNotice
              className="mb-6"
              onRetry={() => { newArrivalsQuery.refetch() }}
              retrying={newArrivalsQuery.isFetching}
            />
          )}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {newArrivalsQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={`home-skel-${i}`} />)
            ) : displayProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                added={addedIds.has(product.id)}
                t={t}
                onAddToCart={handleAddToCart}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="section-y-sm bg-[var(--primary-bg)]">
        <div className="site-container">
          <div className="grid gap-5 lg:grid-cols-3">
            {[
              {
                title: 'Marine and ship spare parts',
                copy: 'Source ship spares for bridge equipment, engine room systems, deck machinery, marine pumps, steering gear, ballast systems, safety equipment, and navigation equipment.',
              },
              {
                title: 'Industrial automation and hydraulics',
                copy: 'Buy ABB, Siemens, Schneider Electric, Parker, Bosch Rexroth, Danfoss, Festo, SMC, Omron, Honeywell, and similar electrical, pneumatic, and hydraulic replacement parts.',
              },
              {
                title: 'RFQ support for rare parts',
                copy: 'Send a part number, maker, model, serial plate, nameplate photo, or vessel details. We help locate new old stock, used, reconditioned, refurbished, and compatible alternatives.',
              },
            ].map((item) => (
              <article key={item.title} className="equal-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]">
                <h3 className="font-display text-xl font-bold text-[var(--text-primary)]">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-y bg-[var(--secondary-bg)]">
        <div className="site-container grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] md:p-8">
            <img
              src="/images/alka-traders-logo.png"
              alt="Alka Traders Logo"
              className="h-12 w-12 rounded-2xl object-cover shadow-sm mb-5"
            />
            <h2 className="font-display text-display-lg font-bold tracking-tight text-[var(--text-primary)]">
              Sourcing built around clarity, condition, and dispatch.
            </h2>
            <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-[var(--text-secondary)]">
              Send a maker, model, part number, serial plate, or product photo. Our team checks availability, condition, compatibility notes, export packing, and freight options before quoting.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
              {[
                ['Marine focus', 'automation, navigation, pumps, engine spares, rigging, and deck equipment.'],
                ['Industrial focus', 'ABB, Siemens, Parker, Bosch Rexroth, Danfoss, Festo, SMC, and similar MRO components.'],
                ['Condition clarity', 'new old stock, used, refurbished, and reconditioned items are labelled before dispatch.'],
                ['Export support', 'DHL, FedEx, air freight, sea freight, and buyer-arranged shipping from India.'],
              ].map(([title, copy]) => (
                <p key={title} className="min-h-[118px] rounded-xl border border-[var(--border)] bg-[var(--surface-soft)]/60 p-4">
                  <strong className="block text-[var(--text-primary)]">{title}</strong>
                  {copy}
                </p>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--navy-deep)] p-6 text-white shadow-[var(--shadow-soft)] md:p-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/70">Urgent vessel procurement</p>
            <h3 className="mt-3 font-display text-3xl font-bold leading-tight text-white">Need a rare ship spare?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/70">Send the part number, photo, maker name, vessel details, and delivery port. We will confirm stock or source an alternative.</p>
            <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-xs font-black uppercase tracking-[0.1em] text-[var(--btn-blue-text)] no-underline hover:bg-[var(--accent-primary-hover)] hover:text-[var(--btn-blue-text)]"><WhatsAppIcon size={16} /> WhatsApp RFQ</a>
          </div>
        </div>
      </section>

      <Suspense fallback={
        <div className="site-container grid grid-cols-1 gap-5 py-10 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      }>
        <StatsBar />
        <HowItWorks />
        <IndustriesTabs />
        <BrandsMarquee />
        <RFQSection />
        <Testimonials />
      </Suspense>
    </>
  )
}
