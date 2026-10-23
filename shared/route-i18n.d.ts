/**
 * Types for the shared route i18n policy (shared/route-i18n.mjs).
 */

export declare const SHIPPED_LOCALES: readonly ['en', 'ar', 'es']
export type ShippedLocale = 'en' | 'ar' | 'es'
export declare const DEFAULT_LOCALE: ShippedLocale
export declare const TRANSLATED_ROUTES: readonly string[]
export declare function toRoutePath(pathname: string): string
export declare function hasTranslatedRoute(pathname: string, locale: string): boolean
export declare function isIndexableRoute(pathname: string, locale: string): boolean
