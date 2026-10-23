import { prisma } from '../server.js'
import { isHubIndexable } from '../utils/hubSeo.js'
import { SHIPPED_LOCALES, TRANSLATED_ROUTES } from '../utils/routeI18n.js'

const BASE_URL = (process.env.FRONTEND_URL || 'https://alkatraders.co').replace(/\/+$/, '')

// ─── Static pages ───────────────────────────────────────────
// The translated static routes come from backend/src/utils/routeI18n.ts — the
// same list the storefront uses to decide what is indexable. Every shipped
// locale has a translated prerendered equivalent for these, so each one is
// emitted per locale with its hreflang alternates.
function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Product image URLs are absolute Cloudinary links — only prefix site-relative ones. */
function absoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${BASE_URL}${url}`
}

/**
 * The canonical URL of a translated static route in a given locale.
 * Every locale is canonical under its own prefix: the bare path 301s to
 * /en/, so hreflang and sitemap entries must carry the prefix too.
 */
function localeUrl(locale: string, route: string): string {
  return `${BASE_URL}/${locale}${route}`
}

/**
 * The hreflang alternates for a translated route: every shipped locale plus
 * x-default (the English page).
 */
function alternatesFor(route: string): string {
  const links = SHIPPED_LOCALES.map(
    (locale) => `    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(localeUrl(locale, route))}" />`,
  )
  links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(localeUrl('en', route))}" />`)
  return links.join('\n')
}

/** The translated static routes that belong in the sitemap. */
function translatedStaticRoutes(): string[] {
  return TRANSLATED_ROUTES as readonly string[] as string[]
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
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${translatedStaticRoutes().flatMap((route) => SHIPPED_LOCALES.map((locale) => `  <url>
    <loc>${escapeXml(localeUrl(locale, route))}</loc>
${alternatesFor(route)}
  </url>`)).join('\n')}
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${translatedStaticRoutes().flatMap((route) => SHIPPED_LOCALES.map((locale) => `  <url>
    <loc>${escapeXml(localeUrl(locale, route))}</loc>
${alternatesFor(route)}
  </url>`)).join('\n')}
</urlset>`
}
