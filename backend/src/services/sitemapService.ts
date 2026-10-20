import { prisma } from '../server.js'
import { isHubIndexable } from '../utils/hubSeo.js'

const BASE_URL = (process.env.FRONTEND_URL || 'https://alkatraders.co').replace(/\/+$/, '')

// ─── Static pages with metadata ──────────────────────────────
const staticPages = [
  '/', '/products', '/brands', '/industries', '/about', '/contact',
  '/network', '/rfq', '/emergency', '/intelligence', '/privacy-policy',
  '/terms-of-service', '/refund-policy',
]

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Product image URLs are absolute Cloudinary links — only prefix site-relative ones. */
function absoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${BASE_URL}${url}`
}

async function buildSitemap(): Promise<string> {
  const [products, brands, categories] = await Promise.all([prisma.product.findMany({
      where: { status: 'published' },
      select: { slug: true, contentUpdatedAt: true, images: { select: { url: true }, take: 1, where: { isMain: true } } },
      orderBy: { contentUpdatedAt: 'desc' },
    }),
    prisma.brand.findMany({
      where: { isVisible: true, products: { some: { status: 'published' } } },
      select: {
        slug: true, updatedAt: true, description: true, seoTitle: true, seoDescription: true, isVisible: true,
        _count: { select: { products: { where: { status: 'published' } } } },
      },
    }),
    prisma.category.findMany({
      where: { isVisible: true, products: { some: { status: 'published' } } },
      select: {
        slug: true, updatedAt: true, description: true, seoTitle: true, seoDescription: true, isVisible: true,
        _count: { select: { products: { where: { status: 'published' } } } },
      },
    })])

  // The same helper drives the storefront hub's `indexable` flag and the
  // server-rendered robots meta, so a hub can never be noindex in HTML yet
  // advertised here. Hidden hubs are filtered out by the query and by the
  // helper; industry entries are directory content only and must never emit
  // /en/industries/:slug/ URLs because no industry detail page exists.
  const eligible = (entity: {
    description: string | null
    seoTitle: string | null
    seoDescription: string | null
    isVisible: boolean
    _count: { products: number }
  }) => isHubIndexable({
    description: entity.description,
    seoTitle: entity.seoTitle,
    seoDescription: entity.seoDescription,
    isVisible: entity.isVisible,
    productCount: entity._count.products,
  })

  const lastmod = (value: Date | string | null | undefined) => {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? '' : `<lastmod>${date.toISOString().split('T')[0]}</lastmod>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticPages.map((page) => `  <url>
    <loc>${BASE_URL}/en${page === '/' ? '/' : `${page}/`}</loc>
  </url>`).join('\n')}
${products.map((product) => `  <url>
    <loc>${BASE_URL}/en/product/${escapeXml(product.slug)}/</loc>${lastmod(product.contentUpdatedAt)}${product.images[0]?.url ? `\n    <image:image>\n      <image:loc>${escapeXml(absoluteUrl(product.images[0].url))}</image:loc>\n    </image:image>` : ''}
  </url>`).join('\n')}
${brands.filter(eligible).map((brand) => `  <url>\n    <loc>${BASE_URL}/en/brands/${escapeXml(brand.slug)}/</loc>${lastmod(brand.updatedAt)}\n  </url>`).join('\n')}
${categories.filter(eligible).map((category) => `  <url>\n    <loc>${BASE_URL}/en/categories/${escapeXml(category.slug)}/</loc>${lastmod(category.updatedAt)}\n  </url>`).join('\n')}
</urlset>`
}

export async function generateSitemap(): Promise<string> {
  return buildSitemap()
}

export function getFallbackSitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map((page) => `  <url>
    <loc>${BASE_URL}/en${page === '/' ? '/' : `${page}/`}</loc>
  </url>`).join('\n')}
</urlset>`
}
