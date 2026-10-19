import { prisma } from '../server.js'

const BASE_URL = (process.env.FRONTEND_URL || 'https://alkatraders.co').replace(/\/+$/, '')

// ─── Static pages with metadata ──────────────────────────────
const staticPages = [
  '/', '/products', '/brands', '/industries', '/about', '/contact',
  '/network', '/rfq', '/emergency', '/privacy-policy',
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
      where: { isVisible: true, description: { not: null }, products: { some: { status: 'published' } } },
      select: { slug: true, updatedAt: true, description: true, seoTitle: true, seoDescription: true },
    }),
    prisma.category.findMany({
      where: { isVisible: true, description: { not: null }, products: { some: { status: 'published' } } },
      select: { slug: true, updatedAt: true, description: true, seoTitle: true, seoDescription: true },
    })])

  const eligible = (entity: { description: string | null; seoTitle: string | null; seoDescription: string | null }) =>
    (entity.description?.trim().length || 0) >= 120 && Boolean(entity.seoTitle?.trim()) && (entity.seoDescription?.trim().length || 0) >= 80

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticPages.map((page) => `  <url>
    <loc>${BASE_URL}/en${page === '/' ? '/' : `${page}/`}</loc>
  </url>`).join('\n')}
${products.map((product) => `  <url>
    <loc>${BASE_URL}/en/product/${escapeXml(product.slug)}/</loc>
    <lastmod>${product.contentUpdatedAt.toISOString().split('T')[0]}</lastmod>${product.images[0]?.url ? `\n    <image:image>\n      <image:loc>${escapeXml(absoluteUrl(product.images[0].url))}</image:loc>\n    </image:image>` : ''}
  </url>`).join('\n')}
${brands.filter(eligible).map((brand) => `  <url>\n    <loc>${BASE_URL}/en/brands/${escapeXml(brand.slug)}/</loc>\n    <lastmod>${brand.updatedAt.toISOString().split('T')[0]}</lastmod>\n  </url>`).join('\n')}
${categories.filter(eligible).map((category) => `  <url>\n    <loc>${BASE_URL}/en/categories/${escapeXml(category.slug)}/</loc>\n    <lastmod>${category.updatedAt.toISOString().split('T')[0]}</lastmod>\n  </url>`).join('\n')}
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
