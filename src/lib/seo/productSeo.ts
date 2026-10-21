/**
 * Product SEO generation — deterministic, fact-grounded.
 *
 * Every value consumed here comes from real product data: the structured
 * fields (brand, sku, condition) and the admin description parsed by
 * src/lib/description.ts (Item Specifics like Manufacturer / Model / IMPA
 * Code / Size / Material). Nothing is invented:
 *   - No fabricated prices or priceValidUntil dates
 *   - No guessed GTINs (IMPA is NEVER placed in gtin — it is an additionalProperty)
 *   - No brand fallback to "Alka Traders" (we are the seller, not the maker)
 *   - Unknown attributes are omitted, not padded with "N/A"
 */

import { isUuidSku, parseDescription } from '../description'
import { isValidGtin } from './productContent'

export interface ProductSeoInput {
  id: string
  seoTitle?: string | null
  seoDescription?: string | null
  slug?: string
  name: string
  sku: string
  brand: string
  category: string
  condition: string
  description?: string
  price: number
  currency?: string
  onSale?: boolean
  salePrice?: number
  inStock: boolean
  stockCount: number
  images?: Array<{ url: string; alt?: string }>
  /** Optional social-share override; the product image remains the default. */
  ogImageUrl?: string | null
  makeOffer?: boolean
  // Structured identity from the admin (DB columns). When present these WIN
  // over values parsed out of the free-text description.
  manufacturer?: string | null
  modelNumber?: string | null
  mpn?: string | null
  gtin?: string | null
  impaCode?: string | null
  specs?: Record<string, string>
}

const BASE_URL = (import.meta.env.VITE_SITE_URL || 'https://alkatraders.co').replace(/\/+$/, '')
const VALID_CURRENCY = /^[A-Z]{3}$/

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
}

/** Clean up a raw supplier-style value for display: collapse whitespace. */
function tidy(v: string): string {
  return v.replace(/\s+/g, ' ').trim()
}

/** Title-case a product type like "marine scupper plug" → "Marine Scupper Plug". */
function titleCase(v: string): string {
  return tidy(v)
    .split(' ')
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** True for values that are real content, not placeholder junk. */
function isUsable(v: string | undefined | null): v is string {
  if (!v) return false
  const s = tidy(v)
  if (!s) return false
  if (/^(n\/?a|tbd|unknown|none|not available|not marked|unbranded|generic|-+)$/i.test(s)) return false
  return true
}

/** A brand name we can safely assert in metadata and Product schema. */
function isRealBrand(v: string | undefined | null): v is string {
  return isUsable(v) && !/^(unknown|unbranded|not marked|generic)$/i.test(tidy(v))
}

/**
 * Extract the product type from the product name. Real catalog names are
 * supplier-style: "TERYair 23-24-83 PB SCUPPER PLUG 60MM MARINE BRASS RUBBER
 * IMPA 232483 NEW". The product type is the leading noun phrase before the
 * first size/identifier token. Falls back to the category slug (readable).
 */
export function extractProductType(name: string, category: string): string {
  const n = tidy(name)
  // Strip trailing condition/availability words
  const stripped = n.replace(/\b(new|unused|used|refurbished|reconditioned|genuine|original)\b/gi, ' ').replace(/\s+/g, ' ').trim()
  // Strip identifier tokens (IMPA codes, model numbers, sizes) and take what's left
  const withoutIdentifiers = stripped
    .replace(/\bimpa\s*:?\s*[\d\s-]+/gi, ' ')
    .replace(/\b\d{2}(\.\d+)?\s*(mm|cm|in|inch|inch|")\b/gi, ' ')
    .replace(/\b[\d]{2,}[-\s][\d]{2,}(?:[-\s][\d]{2,})*[a-z]{0,2}\b/gi, ' ') // model numbers 23-24-83 PB
    .replace(/\b[a-z]\d{2,}[a-z]?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // The longest remaining multi-word sequence is the type ("SCUPPER PLUG")
  const words = withoutIdentifiers.split(' ').filter((w) => w.length > 1)
  // Prefer the LAST 1-3 words before the first size token — in supplier names
  // the type noun usually follows the brand/model ("... PB SCUPPER PLUG 60MM")
  const typeMatch = stripped.match(/\b((?:marine|industrial|hydraulic|pneumatic|electric|electrical|deck|engine|ship|vessel)\s+)?[a-z]{3,}(\s+(plug|pump|valve|motor|sensor|switch|gauge|filter|separator|plate|fitting|coupling|bearing|seal|gasket|controller|drive|starter|relay|breaker|transformer|cable|hose|pipe|strainer|regulator|actuator|compressor|winch|windlass|anchor|chain|shackle|block|hook|lamp|light|panel|meter|monitor|camera|antenna|horn|bell|whistle))\b/i)
  if (typeMatch) return titleCase(typeMatch[0])
  if (words.length >= 1 && words.join(' ').length <= 40) return titleCase(words.join(' '))
  return titleCase(category.replace(/-/g, ' '))
}

interface Identity {
  model?: string
  mpn?: string
  impa?: string
  manufacturer?: string
  size?: string
  material?: string
}

/**
 * Pull verified identity fields for a product. Structured admin columns win;
 * Item Specifics parsed from the description fill anything still unknown.
 * Only real values are returned — no defaults, no guesses.
 */
export function extractIdentity(
  _name: string,
  description?: string,
  structured?: { manufacturer?: string | null; modelNumber?: string | null; mpn?: string | null; impaCode?: string | null },
): Identity {
  const parsed = parseDescription(description || '')
  const specs = new Map(parsed.itemSpecs.map((s) => [s.label.toLowerCase(), s.value]))

  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = specs.get(k)
      if (isUsable(v)) return tidy(v)
    }
    return undefined
  }

  const fromDescription = {
    model: pick('model', 'model number', 'model no', 'manufacturer model'),
    mpn: pick('mpn', 'manufacturer part number', 'part number'),
    impa: pick('impa code', 'impa', 'impa no'),
    manufacturer: pick('manufacturer', 'maker', 'brand'),
    size: pick('size', 'nominal size'),
    material: pick('material', 'body material'),
  }

  // Structured admin-entered columns take precedence (already tidy in DB).
  const structuredIdentity: Identity = {}
  if (isUsable(structured?.manufacturer)) structuredIdentity.manufacturer = tidy(structured!.manufacturer!)
  if (isUsable(structured?.modelNumber)) structuredIdentity.model = tidy(structured!.modelNumber!)
  if (isUsable(structured?.mpn)) structuredIdentity.mpn = tidy(structured!.mpn!)
  if (isUsable(structured?.impaCode)) structuredIdentity.impa = tidy(structured!.impaCode!)

  return { ...fromDescription, ...structuredIdentity }
}

/**
 * Build the SEO title: [Brand] [Model] [Type] | [IMPA/MPN]
 * Cap ~65 chars visible; identifiers win over descriptors when space is short.
 */
export function buildProductTitle(input: ProductSeoInput, identity: Identity, productType: string): string {
  const brand = isRealBrand(input.brand) ? tidy(input.brand) : undefined
  const model = identity.model || identity.mpn
  const impa = identity.impa ? `IMPA ${identity.impa.replace(/\s+/g, '')}` : undefined

  const left = [brand, model, productType].filter(Boolean).join(' ')
  // Prefer the identifier tail when it fits; drop the tail when the left side
  // is already long, so the title never becomes a stuffed keyword chain.
  const withTail = impa && left.length + 3 + impa.length <= 60 ? `${left} | ${impa}` : left
  return tidy(withTail || productType).slice(0, 60)
}

/**
 * Meta description: one or two factual sentences — identity, key verified
 * attribute, procurement CTA. No superlatives, no stuffing.
 */
export function buildMetaDescription(input: ProductSeoInput, identity: Identity, productType: string): string {
  const brand = isRealBrand(input.brand) ? input.brand : undefined
  const parts: string[] = []
  const who = [brand, identity.model].filter(Boolean).join(' ')
  const publicSku = isUuidSku(input.sku) ? '' : tidy(input.sku)
  parts.push(
    who
      ? `${who} ${productType.toLowerCase()} supplied by Alka Traders`
      : publicSku
        ? `${productType} (${publicSku}) supplied by Alka Traders`
        : `${productType} supplied by Alka Traders`,
  )
  if (identity.impa) parts.push(`IMPA ${identity.impa.replace(/\s+/g, '')}`)
  if (identity.size) parts.push(`${identity.size}`)
  if (identity.material) parts.push(identity.material.toLowerCase())
  if (input.makeOffer) parts.push('offer pricing available')
  parts.push(input.inStock ? 'in stock for export dispatch' : 'check availability with our procurement team')
  const desc = `${parts.join(', ')}.`
  return desc.replace(/,\s*\./, '.').slice(0, 158)
}

/**
 * Image alt text: identity-rich when structured data exists
 * ("Tery PB Scupper Plug IMPA 232483"), otherwise falls back to the
 * catalog name. Never guesses — unknown identity fields are just omitted.
 */
export function buildImageAlt(
  name: string,
  identity?: { manufacturer?: string | null; modelNumber?: string | null; mpn?: string | null; impaCode?: string | null },
): string {
  const brand = isUsable(identity?.manufacturer) ? tidy(identity!.manufacturer!) : undefined
  const model = isUsable(identity?.modelNumber) ? tidy(identity!.modelNumber!) : undefined
  const mpn = isUsable(identity?.mpn) ? tidy(identity!.mpn!) : undefined
  const impa = isUsable(identity?.impaCode) ? `IMPA ${tidy(identity!.impaCode!).replace(/\s+/g, '')}` : undefined

  const fromIdentity = [brand, model || mpn, impa].filter(Boolean).join(' ')
  if (fromIdentity && fromIdentity.length >= 12) return fromIdentity.slice(0, 120)
  return tidy(name).slice(0, 120)
}

/**
 * The H1 is the product's catalog name. Building it from brand + model +
 * category produced nonsense for imported marketplace listings whose model
 * field is "Not Marked" (e.g. "GAZ Not Marked Hand Tools") and hid the part
 * the customer was actually viewing. Keep the identifier fallback only for
 * records that somehow have no name.
 */
export function buildH1(input: ProductSeoInput, identity: Identity, productType: string): string {
  const name = tidy(input.name).slice(0, 120)
  if (name) return name
  const brand = isRealBrand(input.brand) ? tidy(input.brand) : undefined
  const model = identity.model || identity.mpn
  return tidy([brand, model, productType].filter(Boolean).join(' '))
}

/** Build the full SEO payload for a product. */
export function buildProductSeo(input: ProductSeoInput): ProductSeoResult {
  const identity = extractIdentity(input.name, input.description, {
    manufacturer: input.manufacturer,
    modelNumber: input.modelNumber,
    mpn: input.mpn,
    impaCode: input.impaCode,
  })
  const productType = extractProductType(input.name, input.category)
  const generatedTitle = buildProductTitle(input, identity, productType)
  const title = input.seoTitle?.trim() || generatedTitle
  const metaDescription = input.seoDescription?.trim() || buildMetaDescription(input, identity, productType)
  const h1 = buildH1(input, identity, productType)

  const effectivePrice = input.onSale && input.salePrice ? input.salePrice : input.price
  const hasRealPrice = Number.isFinite(effectivePrice) && effectivePrice > 0
  const mainImage = input.images?.[0]?.url
  const ogImage = input.ogImageUrl?.trim() || mainImage
  const ogImageAlt = `${h1}${identity.size ? ` — ${identity.size}` : ''}`
  const currency = VALID_CURRENCY.test(String(input.currency || '').toUpperCase())
    ? String(input.currency).toUpperCase()
    : 'USD'
  const gtin = input.gtin?.replace(/\s+/g, '') || undefined
  const canonicalUrl = `${BASE_URL}/en/product/${encodeURIComponent(input.slug || input.id)}/`

  const jsonLd: Record<string, unknown>[] = []

  // Schema description: clean prose from the parsed description (never the raw
  // supplier blob with "KEY FEATURES"/"ITEM SPECIFICS" headers in it).
  // ALL-CAPS fragments under ~60 chars are editor residue ("ITEM SPECIFICS
  // UPDATED AND FINAL"), not prose — reject them rather than ship junk to Google.
  const looksLikeHeaderResidue = (s: string) =>
    s.length <= 60 && s === s.toUpperCase() && /[A-Z]/.test(s)
  const parsed = parseDescription(input.description || '')
  const proseParas = parsed.paragraphs.filter((p) => isUsable(p) && !looksLikeHeaderResidue(p))
  // When the top-level text is only editor residue, use genuine prose from
  // parsed sections (e.g. Condition notes) before falling back to the name.
  const sectionParas = parsed.sections
    .flatMap((s) => s.paragraphs)
    .filter((p) => isUsable(p) && !looksLikeHeaderResidue(p))
    .slice(0, 2)
  const cleanDesc = [...proseParas, ...sectionParas].join(' ')
  const schemaDescription = (isUsable(cleanDesc) ? cleanDesc : tidy(input.name)).slice(0, 300)

  // Real, non-identity specs are useful Product properties. Keep the list
  // short and omit placeholder values; identity is already represented by
  // sku/mpn/model/brand above.
  const identityLabels = new Set([
    'brand', 'manufacturer', 'make', 'model', 'mpn', 'gtin', 'impa', 'impa code',
    'sku', 'condition', 'category', 'custom bundle', 'bundle description',
  ])
  const additionalProperties: Array<Record<string, unknown>> = []
  if (identity.impa) {
    additionalProperties.push({
      '@type': 'PropertyValue',
      name: 'IMPA Code',
      value: identity.impa.replace(/\s+/g, ''),
    })
  }
  for (const [name, value] of Object.entries(input.specs || {})) {
    if (additionalProperties.length >= 8) break
    if (identityLabels.has(name.trim().toLowerCase())) continue
    if (!isUsable(name) || !isUsable(value)) continue
    additionalProperties.push({
      '@type': 'PropertyValue',
      name: tidy(name).slice(0, 100),
      value: tidy(value).slice(0, 300),
    })
  }
  const schemaImages = (input.images || [])
    .map((image) => image.url)
    .filter(Boolean)
    .slice(0, 10)

  // Product schema — real values only. IMPA as additionalProperty (never GTIN).
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: h1,
    description: schemaDescription,
    ...(isUuidSku(input.sku) ? {} : { sku: input.sku }),
    url: canonicalUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
    ...(identity.mpn ? { mpn: identity.mpn } : {}),
    ...(gtin && isValidGtin(gtin) ? { gtin } : {}),
    ...(identity.model ? { model: identity.model } : {}),
    ...(identity.manufacturer ? { manufacturer: { '@type': 'Organization', name: identity.manufacturer } } : {}),
    ...(isRealBrand(input.brand) ? { brand: { '@type': 'Brand', name: tidy(input.brand) } } : {}),
    ...(isUsable(input.category) ? { category: input.category.replace(/-/g, ' ') } : {}),
    ...(schemaImages.length > 0 ? { image: schemaImages } : {}),
    ...(additionalProperties.length > 0 ? { additionalProperty: additionalProperties } : {}),
    ...(hasRealPrice ? { offers: {
      '@type': 'Offer',
      // Canonical URL uses the stable public slug (UUID remains a redirect alias).
      url: canonicalUrl,
      priceCurrency: currency,
      price: effectivePrice.toFixed(2),
      availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: mapCondition(input.condition),
      seller: { '@type': 'Organization', name: 'Alka Traders' },
    } } : {}),
  }
  jsonLd.push(product)

  return {
    title,
    metaDescription,
    h1,
    ogType: 'product',
    productBrand: isRealBrand(input.brand) ? input.brand : undefined,
    productCondition: mapCondition(input.condition),
    productSku: isUuidSku(input.sku) ? '' : input.sku,
    productCategory: input.category.replace(/-/g, ' '),
    productPrice: effectivePrice,
    productCurrency: currency,
    productAvailability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    ogImage,
    ogImageAlt,
    jsonLd,
  }
}

/** Map the internal condition enum to schema.org Offer itemCondition. */
export function mapCondition(condition: string): string {
  switch (condition) {
    case 'new':
    case 'unused':
      return 'https://schema.org/NewCondition'
    case 'refurbished':
    case 'reconditioned':
      return 'https://schema.org/RefurbishedCondition'
    default:
      return 'https://schema.org/UsedCondition'
  }
}
