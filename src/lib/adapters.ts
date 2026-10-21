/**
 * Adapters to transform backend API responses into the frontend Product type.
 * This bridges the shape mismatch between Prisma model output and the
 * existing frontend Product interface.
 */
import type { Product } from '../types'
import { getProductImageUrl } from './utils'

interface ApiProduct {
  id: string
  name: string
  sku: string
  slug: string
  brand?: { id: string; name: string; slug: string; isVisible?: boolean } | null
  category?: { id: string; name: string; slug: string; icon?: string; isVisible?: boolean } | null
  status: string
  availability: string
  condition: string
  shortDescription?: string | null
  description?: string | null
  regularPrice: number | string
  salePrice?: number | string | null
  saleStartsAt?: string | null
  saleEndsAt?: string | null
  currency: string
  showPrice: boolean
  makeOfferEnabled: boolean
  stockCount: number
  lowStockThreshold: number
  warehouseLocation?: string | null
  publicItemLocation?: string | null
  leadTime?: string | null
  isNewArrival: boolean
  isFeatured: boolean
  customLabel?: string | null
  customLabelColor?: string | null
  sortPriority: number
  seoTitle?: string | null
  seoDescription?: string | null
  seoKeywords?: string | string[] | null
  ogImageUrl?: string | null
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  gtin?: string | null
  impaCode?: string | null
  sourceUrl?: string | null
  lastVerifiedAt?: string | null
  images: { id: string; url: string; altText?: string | null; label?: string | null; isMain: boolean; sortOrder: number }[]
  specs: { name: string; value: string }[]
  industries: { industry: { id: string; name: string; slug: string } }[]
  price?: number
  onSale?: boolean
  inStock?: boolean
  keyFeatures?: string[]
  compatibilityNotes?: string | null
  conditionNotes?: string | null
  warrantyNotes?: string | null
  includedItems?: string[]
  excludedItems?: string[]
  legacyId?: string | null
}

export function apiProductToFrontend(api: ApiProduct): Product {
  const regularPrice = Number(api.regularPrice) || 0
  const salePriceNum = api.salePrice ? Number(api.salePrice) : undefined
  const now = new Date()
  const isOnSale =
    salePriceNum != null &&
    salePriceNum < regularPrice &&
    (!api.saleStartsAt || new Date(api.saleStartsAt) <= now) &&
    (!api.saleEndsAt || new Date(api.saleEndsAt) >= now)

  const effectivePrice = isOnSale && salePriceNum ? salePriceNum : regularPrice

  // Product images uploaded from admin are full Cloudinary URLs. Keep those
  // URLs intact: converting them to the retired product-### filename scheme
  // makes the storefront request a non-existent local/static image instead.
  // Prefer the explicitly marked main image, then the first ordered image.
  const mainImage = api.images?.find((img) => img.isMain && img.url)?.url
  const primaryImageUrl = mainImage || api.images?.find((img) => img.url)?.url

  // Products with no image relation must NOT get a fabricated filename: the
  // old UUID/SKU-derived mapping (product-###.jpg) pointed at a random
  // unrelated demo photo. An empty filename resolves to the shared placeholder
  // in getProductImageUrl() instead.
  const filename = primaryImageUrl || ''
  const placeholderUrl = getProductImageUrl()

  return {
    id: api.id,
    slug: api.slug,
    seoTitle: api.seoTitle,
    seoDescription: api.seoDescription,
    seoKeywords: Array.isArray(api.seoKeywords)
      ? api.seoKeywords
      : String(api.seoKeywords || '').split(',').map((value) => value.trim()).filter(Boolean),
    currency: api.currency,
    ogImageUrl: api.ogImageUrl,
    manufacturer: api.manufacturer,
    modelNumber: api.modelNumber,
    mpn: api.mpn,
    gtin: api.gtin,
    impaCode: api.impaCode,
    sourceUrl: api.sourceUrl,
    lastVerifiedAt: api.lastVerifiedAt,
    filename,
    name: api.name,
    brand: api.brand?.name || api.manufacturer?.trim() || 'Unbranded',
    // Hidden hubs return 404 by design, so never link to them.
    brandSlug: api.brand && api.brand.isVisible !== false ? api.brand.slug : undefined,
    sku: api.sku,
    category: (api.category?.slug || 'other-business') as Product['category'],
    categoryName: api.category?.name || undefined,
    categoryVisible: api.category ? api.category.isVisible !== false : false,
    industry: api.industries?.map((i) => i.industry.slug) || [],
    availability: api.availability as Product['availability'],
    // Filter out empty spec values — admins sometimes save a name with no
    // value (e.g. "SCUPPER PLUG: ""), which renders as a junk row on the
    // product page ("SCUPPER PLUG — " with nothing after it).
    specs: Object.fromEntries(
      (api.specs || [])
        .filter((s) => s.name && s.value && s.value.trim().length > 0)
        .map((s) => [s.name, s.value]),
    ),
    description: api.description || api.shortDescription || '',
    shortDescription: api.shortDescription,
    conditionNotes: api.conditionNotes,
    condition: api.condition as Product['condition'],
    price: effectivePrice,
    regularPrice: api.regularPrice != null ? Number(api.regularPrice) : undefined,
    salePrice: isOnSale ? salePriceNum : undefined,
    onSale: isOnSale,
    saleStartsAt: api.saleStartsAt || undefined,
    saleEndsAt: api.saleEndsAt || undefined,
    inStock: api.availability !== 'out-of-stock' && api.stockCount > 0,
    stockCount: api.stockCount,
    customLabel: api.customLabel || undefined,
    customLabelColor: api.customLabelColor || undefined,
    images: api.images?.length
      ? api.images.map((img) => ({
          url: img.url,
          alt: img.altText || `${api.name} - ${img.label || 'View'}`,
          label: img.label || undefined,
        }))
      : [{ url: placeholderUrl, alt: api.name }],
    isNewArrival: api.isNewArrival,
    makeOffer: api.makeOfferEnabled,
  }
}

export function apiProductsToFrontend(apiProducts: ApiProduct[]): Product[] {
  return apiProducts.map((product) => apiProductToFrontend(product as Parameters<typeof apiProductToFrontend>[0]))
}
