/**
 * Types for localized static-page metadata (shared/static-pages-i18n.mjs).
 */

export interface LocalizedPageMeta {
  title: string
  description: string
  h1: string
}

/** Keyed by locale, then by route slug ('' is the home page). */
export declare const LOCALIZED_PAGE_META: Record<string, Record<string, LocalizedPageMeta>>

export declare function getLocalizedPageMeta(
  locale: string,
  slug: string,
): LocalizedPageMeta | null
