import { createContext, useCallback, useContext } from 'react'
import type { Language } from '../types'

/** Supported locales */
export const VALID_LOCALES = ['en', 'ar', 'es'] as const

/** Map locale → og:locale value */
export const LOCALE_TO_OG: Record<Language, string> = {
  en: 'en_US',
  ar: 'ar_SA',
  es: 'es_ES',
}

/**
 * React context providing the current locale to the entire storefront tree.
 * Set by <LocaleProvider /> in App.tsx. Defaults to 'en'.
 */
export const LocaleContext = createContext<Language>('en')
export const useLocale = () => useContext(LocaleContext)

/**
 * Hook that returns a function to convert an absolute storefront path into a
 * locale-prefixed path. Admin and external paths are left untouched.
 *
 * @example
 *   const lp = useLocalizedPath()
 *   lp('/products')       // → '/en/products' (if locale is 'en')
 *   lp('/products')       // → '/ar/products' (if locale is 'ar')
 *   lp('/admin/settings') // → '/admin/settings' (unchanged)
 *   lp('https://example.com') // → 'https://example.com' (unchanged)
 */
export function useLocalizedPath() {
  const locale = useLocale()
  return useCallback((path: string): string => {
    if (path.startsWith('/admin')) return path
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('mailto:') || path.startsWith('tel:')) return path
    if (path.startsWith('#')) return path

    // Every public storefront URL is canonical with a trailing slash (the
    // production host 301s directory-style URLs to that form). Emitting the
    // final URL directly avoids a redirect hop for every internal link and
    // keeps crawl-budget for real pages. Query strings and hashes are kept.
    const suffixIndex = path.search(/[?#]/)
    const pathname = suffixIndex === -1 ? path : path.slice(0, suffixIndex)
    const suffix = suffixIndex === -1 ? '' : path.slice(suffixIndex)
    const hasFileExtension = /\.[a-z0-9]{2,8}$/i.test(pathname)
    const normalized = pathname.endsWith('/') || hasFileExtension
      ? pathname
      : `${pathname}/`

    return `/${locale}${normalized === '/' ? '/' : normalized}${suffix}`
  }, [locale])
}

/**
 * Navigate to the same page in a different locale.
 */
export function switchLocalePath(
  currentPathname: string,
  newLocale: Language,
  search = '',
  hash = '',
): string {
  const segments = currentPathname.split('/').filter(Boolean)
  // If first segment is a valid locale, replace it
  if (segments.length > 0 && VALID_LOCALES.includes(segments[0] as Language)) {
    segments[0] = newLocale
  } else {
    // No locale prefix — prepend one
    segments.unshift(newLocale)
  }
  // Keep filters, pagination, anchors, and the canonical trailing slash when
  // switching language.
  const trailingSlash = currentPathname.endsWith('/') && segments.length > 0 ? '/' : ''
  return '/' + segments.join('/') + trailingSlash + search + hash
}
