/**
 * Shared build-time helper: fetch the published product catalog from the
 * production API for prerendering, sitemap generation, and the Merchant
 * Center feed. NEVER fabricates data — if the API is unreachable the caller
 * proceeds with an empty list and logs the reason (build still succeeds).
 */

const API = process.env.SEO_API_BASE || 'https://api.alkatraders.co'

/**
 * Fetch the admin-configured site title/description so the prerendered
 * homepage matches what server.js injects at request time. Returns null when
 * the API is unreachable or the settings are empty — the caller keeps the
 * route defaults in that case.
 */
export async function fetchSiteSeoSettings() {
  try {
    const res = await fetch(`${API}/api/v1/storefront/settings`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`  ⚠️  Settings API returned ${res.status} — using default homepage metadata.`)
      return null
    }
    const payload = await res.json()
    const settings = payload?.settings || {}
    const title = String(settings['site.seoTitle'] || '').replace(/\s+/g, ' ').trim()
    const description = String(settings['site.seoDescription'] || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    return title || description ? { title, description } : null
  } catch (err) {
    console.warn(`  ⚠️  Settings API unreachable (${err.message}) — using default homepage metadata.`)
    return null
  }
}

/**
 * @param {number} maxPages Safety cap so a broken `totalPages` can't loop forever.
 * @returns {Promise<Array<{id,name,slug,sku,brand,category,condition,price,salePrice,onSale,inStock,description,shortDescription,images,updatedAt}>>}
 */
export async function fetchPublishedProducts({ maxPages = 50, pageSize = 100 } = {}) {
  const products = []
  let page = 1
  while (page <= maxPages) {
    let res
    try {
      res = await fetch(`${API}/api/v1/storefront/products?limit=${pageSize}&page=${page}&sort=name-asc`, {
        signal: AbortSignal.timeout(12000),
      })
    } catch (err) {
      console.warn(`  ⚠️  Product API unreachable (${err.message}) — building without product pages.`)
      return products
    }
    if (!res.ok) {
      console.warn(`  ⚠️  Product API returned ${res.status} — building without product pages.`)
      return products
    }
    const data = await res.json().catch(() => null)
    const batch = data?.products || []
    if (batch.length === 0) break

    for (const p of batch) {
      // Storefront API only returns published products; keep indexable ones only.
      products.push({
        id: p.id,
        name: p.name || '',
        slug: p.slug || '',
        sku: p.sku || '',
        seoTitle: p.seoTitle || '',
        seoDescription: p.seoDescription || '',
        brand: p.brand?.name || 'Unknown',
        brandSlug: p.brand?.slug || '',
        category: p.category?.slug || 'other-business',
        categorySlug: p.category?.slug || '',
        categoryName: p.category?.name || '',
        categoryVisible: p.category ? p.category.isVisible !== false : false,
        condition: p.condition || 'used',
        conditionNotes: p.conditionNotes || null,
        price: Number(p.price ?? p.regularPrice) || 0,
        regularPrice: Number(p.regularPrice) || 0,
        salePrice: p.salePrice != null ? Number(p.salePrice) : null,
        currency: p.currency || 'USD',
        onSale: Boolean(p.onSale),
        makeOffer: Boolean(p.makeOfferEnabled),
        inStock: p.availability !== 'out-of-stock' && (p.stockCount ?? 0) > 0,
        stockCount: p.stockCount ?? 0,
        availability: p.availability || null,
        description: p.description || p.shortDescription || '',
        shortDescription: p.shortDescription || '',
        images: (p.images || []).map((i) => ({
          url: i.url,
          alt: i.altText || '',
          altText: i.altText || '',
          isMain: Boolean(i.isMain),
        })),
        ogImageUrl: p.ogImageUrl || null,
        specs: (p.specs || [])
          .filter((s) => s?.name && s?.value)
          .map((s) => ({ name: s.name, value: s.value })),
        industries: (p.industries || []).map((entry) => ({
          name: entry?.industry?.name || entry?.name || '',
        })),
        // Rich listing facts consumed by the shared product-page engine.
        keyFeatures: Array.isArray(p.keyFeatures) ? p.keyFeatures : [],
        compatibilityNotes: p.compatibilityNotes || null,
        warrantyNotes: p.warrantyNotes || null,
        includedItems: Array.isArray(p.includedItems) ? p.includedItems : [],
        excludedItems: Array.isArray(p.excludedItems) ? p.excludedItems : [],
        leadTime: p.leadTime || null,
        publicItemLocation: p.publicItemLocation || null,
        // Structured identity columns (win over description parsing)
        manufacturer: p.manufacturer || null,
        modelNumber: p.modelNumber || null,
        mpn: p.mpn || null,
        gtin: p.gtin || null,
        impaCode: p.impaCode || null,
        lastVerifiedAt: p.lastVerifiedAt || null,
        updatedAt: p.updatedAt || null,
        contentUpdatedAt: p.contentUpdatedAt || p.updatedAt || null,
      })
    }
    const totalPages = data?.pagination?.totalPages ?? 1
    if (page >= totalPages) break
    page++
  }
  return products
}

/**
 * Extract verified identity (model/mpn/impa/manufacturer/size) from Item
 * Specifics lines in the admin description. Mirrors extractIdentity() in
 * src/lib/seo/productSeo.ts (kept in sync — this is a plain-JS twin for
 * build-time scripts that cannot import TS).
 */
export function extractIdentityQuick(description, structured) {
  const specs = new Map()
  for (const raw of String(description || '').split(/\r?\n/)) {
    const line = raw.trim()
    const m = line.match(/^([^:]{1,40}):(.*)$/)
    if (!m) continue
    const label = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (value && !/^(n\/a|tbd|unknown|none|not available|-+)$/i.test(value)) specs.set(label, value)
  }
  const pick = (...keys) => {
    for (const k of keys) if (specs.has(k)) return specs.get(k)
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
  // Structured admin columns win (mirrors productSeo.ts)
  const structuredIdentity = {}
  if (structured?.manufacturer) structuredIdentity.manufacturer = String(structured.manufacturer).trim()
  if (structured?.modelNumber) structuredIdentity.model = String(structured.modelNumber).trim()
  if (structured?.mpn) structuredIdentity.mpn = String(structured.mpn).trim()
  if (structured?.impaCode) structuredIdentity.impa = String(structured.impaCode).trim()
  return { ...fromDescription, ...structuredIdentity }
}

const TYPE_NOUN_RE = /\b((?:marine|industrial|hydraulic|pneumatic|electric|electrical|deck|engine|ship|vessel)\s+)?[a-z]{3,}(\s+(plug|pump|valve|motor|sensor|switch|gauge|filter|separator|plate|fitting|coupling|bearing|seal|gasket|controller|drive|starter|relay|breaker|transformer|cable|hose|pipe|strainer|regulator|actuator|compressor|winch|windlass|anchor|chain|shackle|block|hook|lamp|light|panel|meter|monitor|camera|antenna|horn|bell|whistle))\b/i

/**
 * Derive a clean product type from a supplier-style name. Mirrors
 * extractProductType() in src/lib/seo/productSeo.ts.
 */
export function extractProductTypeQuick(name, category) {
  const stripped = String(name || '')
    .replace(/\b(new|unused|used|refurbished|reconditioned|genuine|original)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = stripped.match(TYPE_NOUN_RE)
  if (m) {
    return m[0].replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return String(category || 'product').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Build the fact-grounded SEO title for a product (matches productSeo.ts). */
export function buildProductTitleQuick(p) {
  const identity = extractIdentityQuick(p.description, {
    manufacturer: p.manufacturer,
    modelNumber: p.modelNumber,
    mpn: p.mpn,
    impaCode: p.impaCode,
  })
  const productType = extractProductTypeQuick(p.name, p.category)
  const brand = p.brand && p.brand !== 'Unknown' ? p.brand : undefined
  const model = identity.model || identity.mpn
  const impa = identity.impa ? `IMPA ${identity.impa.replace(/\s+/g, '')}` : undefined
  const left = [brand, model, productType].filter(Boolean).join(' ')
  const withTail = impa && left.length + 3 + impa.length <= 70 ? `${left} | ${impa}` : left
  return (withTail || productType).trim().slice(0, 70)
}
