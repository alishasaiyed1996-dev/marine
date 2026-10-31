/**
 * Product SEO — typed wrapper around the shared product-page engine.
 *
 * All product copy, titles, meta descriptions, specs, sections, FAQs and
 * JSON-LD are generated in shared/product-page.mjs so the React page, the
 * build-time prerenderer and the Express server cannot drift apart.
 *
 * Nothing is invented:
 *   - No fabricated prices, ratings, reviews or shipping times
 *   - IMPA is an additionalProperty, never a GTIN
 *   - "Alka Traders" is the seller, never the manufacturer
 *   - Unknown values are omitted rather than filled with "N/A"
 */

import {
  buildProductPage,
  buildImageAlt as sharedBuildImageAlt,
} from '../../../shared/product-page.mjs'
import type {
  BuildProductPageOptions,
  ProductPageInput,
  ProductPageModel,
} from '../../../shared/product-page.mjs'

const BASE_URL = (import.meta.env.VITE_SITE_URL || 'https://alkatraders.co').replace(/\/+$/, '')

export interface ProductSeoInput extends ProductPageInput {
  id: string
  name: string
  sku: string
  brand: string
  category: string
  condition: string
  price: number
  inStock: boolean
  stockCount: number
  images?: Array<{ url: string; alt?: string }>
}

export interface ProductSeoResult {
  /** Page title WITHOUT the "| Alka Traders" suffix (SEO.tsx appends it). */
  title: string
  metaDescription: string
  h1: string
  ogType: 'product'
  productBrand?: string
  productCondition?: string
  productSku: string
  productCategory: string
  productPrice: number
  productCurrency: string
  productAvailability: string
  ogImage?: string
  ogImageAlt: string
  jsonLd: Record<string, unknown>[]
  /** Full page model used by the visible product page. */
  page: ProductPageModel
}

/** Build the complete SEO payload and visible page model for one product. */
export function buildProductSeo(
  input: ProductSeoInput,
  options: Pick<BuildProductPageOptions, 'locale' | 'related' | 'siblings'> = {},
): ProductSeoResult {
  const page = buildProductPage(input, { baseUrl: BASE_URL, ...options })

  return {
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    ogType: 'product',
    productBrand: page.brand || undefined,
    productCondition: page.conditionSchema,
    productSku: page.sku,
    productCategory: page.category.name || String(input.category || '').replace(/-/g, ' '),
    productPrice: page.price,
    productCurrency: page.currency,
    productAvailability: page.inStock
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    ogImage: page.ogImage || undefined,
    ogImageAlt: page.ogImageAlt,
    jsonLd: page.jsonLd,
    page,
  }
}

/** Identity-rich image alt text; falls back to the catalog name. */
export function buildImageAlt(
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
): string {
  return sharedBuildImageAlt(name, identity)
}

export type { ProductPageModel }
