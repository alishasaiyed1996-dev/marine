/**
 * Types for the shared product-page engine (shared/product-page.mjs).
 * The implementation is deliberately plain ESM so the React app, the
 * prerenderer and the Express server can import the exact same module.
 */

export interface ProductPageSpec {
  label: string
  value: string
}

export interface ProductPageSection {
  id: string
  title: string
  paragraphs: string[]
  bullets: string[]
}

export interface ProductPageFaq {
  question: string
  answer: string
}

export interface ProductPageImage {
  url: string
  alt: string
  isMain: boolean
}

export interface ProductPageBreadcrumb {
  name: string
  path: string
}

export interface ProductPageRelated {
  name: string
  slug: string
  sku: string
  model: string
  href: string
}

export interface ProductPageCategory {
  slug: string
  name: string
  visible: boolean
}

export interface ProductPageInput {
  id?: string | null
  slug?: string | null
  name?: string | null
  sku?: string | null
  brand?: string | { name?: string | null } | null
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  gtin?: string | null
  impaCode?: string | null
  condition?: string | null
  description?: string | null
  shortDescription?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  price?: number | string | null
  regularPrice?: number | string | null
  salePrice?: number | string | null
  currency?: string | null
  onSale?: boolean | null
  inStock?: boolean | null
  stockCount?: number | null
  availability?: string | null
  makeOffer?: boolean | null
  images?: Array<{ url?: string | null; alt?: string | null; altText?: string | null; isMain?: boolean | null }> | null
  ogImageUrl?: string | null
  specs?: Record<string, string> | Array<{ name?: string; label?: string; value?: string }> | null
  industries?: Array<{ industry?: { name?: string | null } | null; name?: string | null } | string> | null
  category?: string | { slug?: string | null; name?: string | null; isVisible?: boolean | null } | null
  categoryName?: string | null
  categoryVisible?: boolean | null
  keyFeatures?: string[] | null
  compatibilityNotes?: string | null
  conditionNotes?: string | null
  warrantyNotes?: string | null
  includedItems?: string[] | null
  excludedItems?: string[] | null
  leadTime?: string | null
  publicItemLocation?: string | null
  lastVerifiedAt?: string | null
}

export interface MerchantReturnPolicyOptions {
  returnWindowDays?: number
  returnFees?: string
  returnMethod?: string
  returnPolicyCategory?: string
  applicableCountry?: string
}

export interface BuildProductPageOptions {
  baseUrl?: string
  locale?: string
  related?: ProductPageInput[]
  siblings?: ProductPageInput[]
  /** Overrides the store's merchant return policy in the Product JSON-LD. */
  returnPolicy?: MerchantReturnPolicyOptions
}

export interface ProductPageModel {
  id: string
  slug: string
  name: string
  h1: string
  productType: string
  brand: string
  manufacturer: string
  model: string
  mpn: string
  impa: string
  gtin: string
  sku: string
  condition: string
  conditionLabel: string
  conditionSchema: string
  packPhrase: string
  category: ProductPageCategory
  currency: string
  price: number
  regularPrice: number
  salePrice: number | null
  onSale: boolean
  inStock: boolean
  stockCount: number
  makeOffer: boolean
  leadTime: string
  publicItemLocation: string
  title: string
  metaDescription: string
  canonicalUrl: string
  canonicalPath: string
  ogImage: string
  ogImageAlt: string
  images: ProductPageImage[]
  overview: string[]
  features: string[]
  specs: ProductPageSpec[]
  identifierRows: ProductPageSpec[]
  sections: ProductPageSection[]
  faqs: ProductPageFaq[]
  related: ProductPageRelated[]
  breadcrumbs: ProductPageBreadcrumb[]
  schemaDescription: string
  jsonLd: Record<string, unknown>[]
  productSchema: Record<string, unknown>
  faqSchema: Record<string, unknown> | null
}

export interface ParsedDescription {
  itemSpecs: ProductPageSpec[]
  features: string[]
  sections: Array<{ key: string; title: string; paragraphs: string[]; bullets: string[] }>
  paragraphs: string[]
}

export declare function buildProductPage(
  input: ProductPageInput | null | undefined,
  options?: BuildProductPageOptions,
): ProductPageModel

export declare function parseDescription(raw: string | null | undefined): ParsedDescription

export declare function renderProductBodyHtml(
  model: ProductPageModel,
  options?: { locale?: string; includeFooter?: boolean },
): string

export declare function buildImageAlt(
  name: string,
  identity?: {
    manufacturer?: string | null
    brand?: string | null
    modelNumber?: string | null
    model?: string | null
    mpn?: string | null
    impaCode?: string | null
    impa?: string | null
  },
): string

export declare function mapProductCondition(condition: string | null | undefined): string
export declare function mapCondition(condition: string | null | undefined): string
export declare function conditionLabel(condition: string | null | undefined): string

/**
 * The store's merchant return policy — one definition shared by the
 * prerendered JSON-LD, the SPA JSON-LD, and the visible product badge.
 */
export declare const RETURN_POLICY: Required<MerchantReturnPolicyOptions>
export declare function buildMerchantReturnPolicy(
  overrides?: MerchantReturnPolicyOptions,
): Record<string, unknown>

export declare const SITE_NAME: string
export declare const DEFAULT_BASE_URL: string
