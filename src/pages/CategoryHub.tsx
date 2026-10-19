import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { storefront } from '../lib/api'
import { apiProductsToFrontend } from '../lib/adapters'
import { SEO } from '../components/seo/SEO'
import { BreadcrumbJsonLd } from '../components/seo/BreadcrumbJsonLd'
import { ProductGrid } from '../components/product/ProductGrid'
import { useAddToCart } from '../hooks/useAddToCart'
import { useStore } from '../store/useStore'

export default function CategoryHub() {
  const { slug = '' } = useParams()
  const language = useStore((state) => state.language)
  const { handleAddToCart, addedIds } = useAddToCart()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['category-hub', slug],
    queryFn: async () => {
      const { category } = await storefront.categories.get(slug)
      return category
    },
  })
  const category = data as any
  const products = apiProductsToFrontend(category?.products || [])
  const description = category?.description || ''
  const indexable = Boolean(description.trim().length >= 120 && (category?._count?.products || 0) > 0)
  const title = category?.seoTitle || `${category?.name || 'Marine spare parts'} | Alka Traders`
  const metaDescription = category?.seoDescription || description.slice(0, 160)

  if (isError) return <main className="mx-auto max-w-5xl px-4 py-20"><h1>Category not found</h1><Link to="/products/">Browse products</Link></main>
  return <main className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6">
    {category && <>
      <SEO title={title} description={metaDescription} canonical={`/categories/${category.slug}/`} noindex={!indexable} />
      <BreadcrumbJsonLd items={[{ name: 'Home', url: '/' }, { name: 'Products', url: '/products/' }, { name: category.name, url: `/categories/${category.slug}/` }]} />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm"><Link to={`/${language}/`}>Home</Link> / <Link to={`/${language}/products/`}>Products</Link> / {category.name}</nav>
      <header className="mb-10 max-w-4xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--accent-gold)]">Marine and industrial catalog</p>
        <h1 className="font-display text-4xl font-extrabold">{category.name} spare parts</h1>
        {description ? <p className="mt-4 whitespace-pre-line text-[var(--text-secondary)]">{description}</p> : <p className="mt-4 text-[var(--text-secondary)]">Browse published marine and industrial {category.name.toLowerCase()} parts available from Alka Traders.</p>}
      </header>
      {category.children?.length > 0 && <nav aria-label="Subcategories" className="mb-8 flex flex-wrap gap-3">{category.children.map((child: any) => <Link key={child.id} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm" to={`/${language}/categories/${child.slug}/`}>{child.name}</Link>)}</nav>}
      <h2 className="mb-5 text-2xl font-bold">Available {category.name} products ({category._count?.products || 0})</h2>
      {!products.length && !isLoading ? <p className="rounded-xl border border-[var(--border)] p-6">No published products are available in this category yet.</p> : <ProductGrid products={products} addedIds={addedIds} onAddToCart={handleAddToCart} isLoading={isLoading} />}
      <Link to={`/${language}/products/`} className="mt-8 inline-block underline">All products</Link>
    </>}
  </main>
}
