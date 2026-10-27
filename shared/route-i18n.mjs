/**
 * Which storefront routes have a verified translated equivalent.
 *
 * The audit found the storefront offering Arabic and Spanish while every SEO
 * layer told Google not to index them — a half-indexed language layer. The
 * fix is per-page honesty:
 *
 *   - Pages listed here have translated crawlable copy (the prerenderer emits
 *     them in `ar` and `es`) and are indexable in every shipped locale.
 *   - Everything else — the product catalog, category hubs, brand hubs — is
 *     English data. Those pages stay indexable in English only, and their
 *     Arabic/Spanish variants stay `noindex` with an hreflang pointing at the
 *     English page.
 *
 * The server, the prerenderer, the React SEO component and the sitemap all
 * read this one list, so the policy cannot drift between layers.
 */

/** The locales the storefront ships. */
export const SHIPPED_LOCALES = ['en', 'ar', 'es']

/** The default locale — the x-default for hreflang and the sitemap base. */
export const DEFAULT_LOCALE = 'en'

/**
 * Route paths (locale-agnostic, trailing slash) that have a translated
 * prerendered equivalent. These are the marketing and legal pages whose copy
 * lives in the locale bundles.
 */
export const TRANSLATED_ROUTES = [
  '/',
  '/products/',
  '/industries/',
  '/brands/',
  '/about/',
  '/rfq/',
  '/contact/',
  '/emergency/',
  '/network/',
  '/intelligence/',
  '/privacy-policy/',
  '/terms-of-service/',
  '/refund-policy/',
]

/**
 * Normalizes a request path to the locale-agnostic, trailing-slash form used
 * by TRANSLATED_ROUTES. `/ar/products` → `/products/`.
 */
export function toRoutePath(pathname) {
  let clean = String(pathname || '/').split(/[?#]/)[0].replace(/\/{2,}/g, '/')
  clean = clean.replace(/^\/(en|ar|es)(?=\/|$)/i, '')
  if (clean === '') return '/'
  return clean.endsWith('/') ? clean : `${clean}/`
}

/**
 * True when the given path has a verified translation in the given locale.
 * English is always "translated" — it is the source language.
 */
export function hasTranslatedRoute(pathname, locale) {
  const loc = String(locale || 'en').toLowerCase()
  if (loc === DEFAULT_LOCALE) return true
  const route = toRoutePath(pathname)
  return TRANSLATED_ROUTES.includes(route)
}

/**
 * True when the page may be indexed. Non-English pages are indexable only
 * when a verified translation exists for them.
 */
export function isIndexableRoute(pathname, locale) {
  return hasTranslatedRoute(pathname, locale)
}

/**
 * The hreflang alternates for ONE page — exactly the sitemap's policy
 * (backend/src/services/sitemapService.ts `alternatesFor`): every shipped
 * locale plus x-default (the English page) for routes in TRANSLATED_ROUTES,
 * and NOTHING for pages the sitemap lists without alternates (products,
 * brand/category hubs). Accepts a path ('/en/products/') or an absolute URL
 * ('https://alkatraders.co/en/products/'). The server, the prerenderer and
 * the sitemap all read this one policy, so the layers cannot drift.
 */
export function hreflangAlternatesFor(pathOrUrl, baseUrl) {
  let pathname = String(pathOrUrl || '/')
  try {
    pathname = new URL(pathname).pathname
  } catch {
    // Relative path — use as-is.
  }
  const route = toRoutePath(pathname)
  if (!TRANSLATED_ROUTES.includes(route)) return []
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const links = SHIPPED_LOCALES.map((locale) => ({
    hreflang: locale,
    href: `${base}/${locale}${route}`,
  }))
  links.push({ hreflang: 'x-default', href: `${base}/en${route}` })
  return links
}
