import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { storefront } from '../lib/api'
import { apiProductsToFrontend } from '../lib/adapters'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import { ProductGrid } from '../components/product/ProductGrid'
import { useAddToCart } from '../hooks/useAddToCart'
import { useStore } from '../store/useStore'

export default function BrandHub() {
  const { slug = '' } = useParams()
  const language = useStore((state) => state.language)
  const { handleAddToCart, addedIds } = useAddToCart()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['brand-hub', slug],
    queryFn: async () => {
      const { brand } = await storefront.brands.get(slug)
      return brand
    },
  })
  const brand = data as any
  const products = apiProductsToFrontend(brand?.products || [])
  const description = brand?.description || ''
  // The API computes this with backend/src/utils/hubSeo.ts, the same function
  // the sitemap and the server-rendered robots meta use. Never re-implement
  // the rule here or a hidden/thin hub can diverge from the sitemap.
  const indexable = brand?.indexable === true
  const title = brand?.seoTitle || `${brand?.name || 'Marine parts'} spare parts | Alka Traders`
  const metaDescription = brand?.seoDescription || description.slice(0, 160)

  if (isError) return <main className="mx-auto max-w-5xl px-4 py-20"><SEO title="Brand not found | Alka Traders" description="The requested brand page is not available. Browse the Alka Traders brand directory." noindex /><h1>Brand not found</h1><Link to={`/${language}/brands/`}>Browse brands</Link></main>
  return <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
    {brand && <>
      <SEO title={title} description={metaDescription} canonical={`/brands/${brand.slug}/`} noindex={!indexable} />
      <BreadcrumbJsonLd items={[{ name: 'Home', url: '/' }, { name: 'Brands', url: '/brands/' }, { name: brand.name, url: `/brands/${brand.slug}/` }]} />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm"><Link to={`/${language}/`}>Home</Link> / <Link to={`/${language}/brands/`}>Brands</Link> / {brand.name}</nav>
      <header className="mb-10 max-w-4xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--accent-gold)]">Marine and industrial spares</p>
        <h1 className="font-display text-4xl font-extrabold">{brand.name} spare parts</h1>
        {description ? <p className="mt-4 whitespace-pre-line text-[var(--text-secondary)]">{description}</p> : <p className="mt-4 text-[var(--text-secondary)]">Browse published {brand.name} equipment and spare parts available from Alka Traders.</p>}
      </header>
      <h2 className="mb-5 text-2xl font-bold">Available {brand.name} parts ({brand._count?.products || 0})</h2>
      {!products.length && !isLoading ? <p className="rounded-xl border border-[var(--border)] p-6">No published products are available in this brand yet.</p> : <ProductGrid products={products} addedIds={addedIds} onAddToCart={handleAddToCart} isLoading={isLoading} />}
      {products.length < (brand._count?.products || 0) && (
        <Link to={`/${language}/products?brand=${encodeURIComponent(brand.slug)}`} className="mt-6 inline-block font-semibold underline">
          View all {brand._count.products} {brand.name} products
        </Link>
      )}
      {brand.sectors?.length > 0 && <p className="mt-8 text-sm text-[var(--text-muted)]">Sectors: {brand.sectors.join(', ')}</p>}
      <Link to={`/${language}/brands/`} className="mt-8 inline-block underline">All brands</Link>
    </>}
  </main>
}
