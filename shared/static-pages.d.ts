/**
 * Types for the shared static-page metadata manifest
 * (shared/static-pages.mjs). Imported by the Express server, the prerenderer
 * and the React SEO layer.
 */

export declare const SITE_NAME: string

export interface StaticPageMeta {
  /** Document title, including the brand suffix. */
  title: string
  /** Meta description (~150-160 characters). */
  description: string
  /** Visible page heading (prerendered body). */
  h1: string
}

/** Keyed by route slug; '' is the home page. */
export declare const STATIC_PAGE_META: Record<string, StaticPageMeta>

/** Every static route slug, in navigation order. */
export declare const STATIC_PAGE_SLUGS: string[]

export declare function getStaticPageMeta(slug: string): StaticPageMeta | null
