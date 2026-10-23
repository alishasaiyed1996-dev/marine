import { STATIC_PAGE_META } from '../../../shared/static-pages.mjs'
import { getLocalizedPageMeta } from '../../../shared/static-pages-i18n.mjs'
import { useLocale } from '../locale'

/**
 * Resolve a static page's title and description from the shared manifest.
 *
 * The prerendered HTML, the server's fallback shell and the hydrated React page
 * must agree on how a page is described. Before this helper existed each layer
 * carried its own copy: the prerendered catalog page said "Marine Spare Parts &
 * Ship Spares Catalog", the server fallback said "Marine Spare Parts Catalog |
 * Ship Spares & Engine Parts", and several pages dropped the brand suffix
 * entirely once React mounted. See S-4/D-8 in "complete codebase fix.md".
 *
 * Titles and descriptions come from `shared/static-pages.mjs` (English) and
 * `shared/static-pages-i18n.mjs` (Arabic, Spanish).
 */
export interface StaticPageSeo {
  title: string
  description: string
}

/**
 * @param slug Route slug from `shared/static-pages.mjs` ('' is home).
 * @param language Shipped locale code.
 */
export function staticPageSeo(slug: string, language: string): StaticPageSeo {
  const base = STATIC_PAGE_META[slug]
  if (!base) {
    throw new Error(
      `Unknown static page slug "${slug}" — add it to shared/static-pages.mjs.`,
    )
  }
  // English is the canonical copy in the manifest; AR/ES carry translations of
  // the same three fields and fall back to English if one is missing.
  const localized = language === 'en' ? null : getLocalizedPageMeta(language, slug)
  return {
    title: localized?.title || base.title,
    description: localized?.description || base.description,
  }
}

/** Same as {@link staticPageSeo}, using the locale from the router context. */
export function useStaticPageSeo(slug: string): StaticPageSeo {
  return staticPageSeo(slug, useLocale())
}
