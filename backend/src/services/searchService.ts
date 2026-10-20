import { prisma } from '../server.js'

export type SearchResultType = 'product' | 'category' | 'brand'

export interface SearchResult {
  id: string
  slug?: string
  type: SearchResultType
  title: string
  description: string
  path: string
  price?: number
  imageUrl?: string
  brand?: string
}

export async function fullTextSearch(query: string): Promise<{
  results: SearchResult[]
  total: number
}> {
  if (!query.trim()) return { results: [], total: 0 }

  const search = query.trim()

  const [products, categories, brands] = await Promise.all([
    prisma.product.findMany({
      where: {
        status: 'published',
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { seoKeywords: { contains: search, mode: 'insensitive' } },
          { manufacturer: { contains: search, mode: 'insensitive' } },
          { modelNumber: { contains: search, mode: 'insensitive' } },
          { mpn: { contains: search, mode: 'insensitive' } },
          { impaCode: { contains: search, mode: 'insensitive' } },
          { gtin: { contains: search, mode: 'insensitive' } },
          { brand: { name: { contains: search, mode: 'insensitive' } } },
          { category: { name: { contains: search, mode: 'insensitive' } } },
        ],
      },
      include: {
        brand: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
        images: { where: { isMain: true }, take: 1, select: { url: true } },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.category.findMany({
      where: { isVisible: true, OR: [{ name: { contains: search, mode: 'insensitive' } }] },
      take: 5,
      include: { _count: { select: { products: { where: { status: 'published' } } } } },
    }),
    prisma.brand.findMany({
      where: { isVisible: true, OR: [{ name: { contains: search, mode: 'insensitive' } }] },
      take: 5,
      include: { _count: { select: { products: { where: { status: 'published' } } } } },
    }),
  ])

  const results: SearchResult[] = [
    ...products.map(p => ({
      id: p.id,
      slug: p.slug,
      type: 'product' as const,
      name: p.name,
      title: p.name,
      sku: p.sku,
      description: p.description?.slice(0, 120) || '',
      path: `/product/${p.slug}`,
      price: Number(p.salePrice && Number(p.salePrice) < Number(p.regularPrice) ? p.salePrice : p.regularPrice),
      imageUrl: p.images[0]?.url,
      brand: p.brand?.name,
    })),
    ...categories.map(c => ({
      id: c.id,
      type: 'category' as const,
      name: c.name,
      title: c.name,
      slug: c.slug,
      productCount: c._count.products,
      description: `${c._count.products} products`,
      path: `/products?category=${c.slug}`,
    })),
    ...brands.map(b => ({
      id: b.id,
      type: 'brand' as const,
      name: b.name,
      title: b.name,
      slug: b.slug,
      productCount: b._count.products,
      description: `${b._count.products} products`,
      path: `/products?brand=${b.slug}`,
    })),
  ]

  return { results, total: results.length }
}
