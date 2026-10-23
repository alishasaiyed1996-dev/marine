/**
 * Routes that have a verified translated equivalent.
 *
 * The canonical definition lives in `shared/route-i18n.mjs`, which the
 * frontend server, the prerenderer and the React SEO component all read. The
 * backend API is deployed from the `backend/` directory only, so it cannot
 * import that module at runtime — this is a deliberate, test-enforced copy.
 *
 * `backend/src/__tests__/routeI18n.test.ts` asserts the two lists are
 * identical, so the sitemap can never advertise a translated URL that the
 * storefront refuses to index.
 */

/** The locales the storefront ships. */
export const SHIPPED_LOCALES = ['en', 'ar', 'es'] as const
export type ShippedLocale = (typeof SHIPPED_LOCALES)[number]

export const DEFAULT_LOCALE: ShippedLocale = 'en'

/** Locale-agnostic, trailing-slash routes with a translated prerendered page. */
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
] as const

/** Normalizes a path to the locale-agnostic, trailing-slash form. */
export function toRoutePath(pathname: string): string {
  let clean = String(pathname || '/').split(/[?#]/)[0].replace(/\/{2,}/g, '/')
  clean = clean.replace(/^\/(en|ar|es)(?=\/|$)/i, '')
  if (clean === '') return '/'
  return clean.endsWith('/') ? clean : `${clean}/`
}

/** True when the route has a verified translation in the given locale. */
export function hasTranslatedRoute(pathname: string, locale: string): boolean {
  const loc = String(locale || 'en').toLowerCase()
  if (loc === DEFAULT_LOCALE) return true
  return (TRANSLATED_ROUTES as readonly string[]).includes(toRoutePath(pathname))
}
