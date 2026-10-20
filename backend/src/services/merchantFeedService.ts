import { prisma } from '../server.js'
import { getEffectivePrice, isOnSale } from '../utils/helpers.js'

/**
 * Google Merchant Center product feed (XML, g: namespace).
 *
 * FACT-GROUNDING RULES (non-negotiable):
 *  - Only published products with showPrice=true and a real price are included.
 *    Quote-only / informational products are NOT marked up with invented prices.
 *  - brand = the product's real brand. "Alka Traders" is the SELLER, not the
 *    manufacturer, and is never asserted as brand.
 *  - gtin is only emitted when a verified manufacturer GTIN exists (field is
 *    populated by admins; IMPA codes are NEVER placed in gtin).
 *  - mpn comes from the stored MPN column when present.
 *  - availability/price mirror the website exactly — feed and page must agree.
 */

const BASE_URL = process.env.FRONTEND_URL || 'https://alkatraders.co'

/** GS1 GTIN-8/12/13/14. Anything else must not reach Google as g:gtin. */
const VALID_GTIN_PATTERN = /^(\d{8}|\d{12,14})$/

// 1-hour cache — Merchant Center refetches at most every 30 min.
let cachedXml: string | null = null
let cacheTime = 0
const CACHE_TTL_MS = 60 * 60 * 1000

function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Extract identity fields from Item Specifics in the description. */
function extractIdentity(description: string | null): { mpn?: string; impa?: string } {
  const specs = new Map<string, string>()
  for (const raw of String(description || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^([^:]{1,40}):(.*)$/)
    if (!m) continue
    const label = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (value && !/^(n\/a|tbd|unknown|none|not available|-+)$/i.test(value)) specs.set(label, value)
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) if (specs.has(k)) return specs.get(k)
    return undefined
  }
  return {
    mpn: pick('mpn', 'manufacturer part number', 'part number', 'model', 'model number'),
    impa: pick('impa code', 'impa'),
  }
}

/** Derive a clean product type from the supplier-style name. */
function productTypeOf(name: string, categorySlug: string): string {
  const TYPE_NOUN_RE = /\b((?:marine|industrial|hydraulic|pneumatic|electric|electrical|deck|engine|ship|vessel)\s+)?[a-z]{3,}(\s+(plug|pump|valve|motor|sensor|switch|gauge|filter|separator|plate|fitting|coupling|bearing|seal|gasket|controller|drive|starter|relay|breaker|transformer|cable|hose|pipe|strainer|regulator|actuator|compressor|winch|windlass|anchor|chain|shackle|block|hook|lamp|light|panel|meter|monitor|camera|antenna|horn|bell|whistle))\b/i
  const stripped = String(name || '')
    .replace(/\b(new|unused|used|refurbished|reconditioned|genuine|original)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = stripped.match(TYPE_NOUN_RE)
  if (m) return m[0].replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  return String(categorySlug || 'product').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Clean, short feed description from parsed description paragraphs. */
function feedDescription(name: string, description: string | null, shortDescription: string | null): string {
  const residue = (s: string) => s.length <= 60 && s === s.toUpperCase() && /[A-Z]/.test(s)
  const paragraphs: string[] = []
  for (const raw of String(description || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^[^:]{1,40}:/.test(line)) continue // Item Specifics pairs — shown on page
    if (/^(key features?|condition|included|excluded|shipping|warranty|notes?|packaging|compatib)/i.test(line)) continue
    if (residue(line)) continue
    paragraphs.push(line)
    if (paragraphs.length >= 2) break
  }
  const base = paragraphs.join(' ') || String(shortDescription || '') || String(name || '')
  return base.slice(0, 5000)
}

async function buildFeed(): Promise<string> {
  const products = await prisma.product.findMany({
    where: { status: 'published', showPrice: true },
    select: {
      id: true,
      slug: true,
      name: true,
      sku: true,
      gtin: true,
      mpn: true,
      impaCode: true,
      brand: { select: { name: true } },
      category: { select: { slug: true, name: true } },
      condition: true,
      regularPrice: true,
      salePrice: true,
      saleStartsAt: true,
      saleEndsAt: true,
      currency: true,
      stockCount: true,
      availability: true,
      description: true,
      shortDescription: true,
      updatedAt: true,
      images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 3 },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const items = products.map((p) => {
    const stored = extractIdentity(p.description)
    const mpn = p.mpn || stored.mpn
    const impa = p.impaCode || stored.impa
    const onSale = isOnSale(p)
    // Google requires g:price to be the regular price; the active sale amount
    // is expressed separately via g:sale_price.
    const price = Number(p.regularPrice)
    const salePrice = getEffectivePrice(p)
    const brand = p.brand?.name && p.brand.name !== 'Unknown' ? p.brand.name : null
    // A malformed legacy GTIN must never be emitted; Google rejects the whole
    // item for structured-data errors. Empty is always safer than wrong.
    const gtin = String(p.gtin || '').replace(/\s+/g, '')
    const validGtin = VALID_GTIN_PATTERN.test(gtin) ? gtin : ''

    const lines: string[] = []
    lines.push('    <item>')
    lines.push(`      <g:id>${escapeXml(p.id)}</g:id>`)
    lines.push(`      <g:title>${escapeXml([brand, mpn || p.name.slice(0, 40), productTypeOf(p.name, p.category?.slug || '')].filter(Boolean).join(' ').slice(0, 150))}</g:title>`)
    lines.push(`      <g:description>${escapeXml(feedDescription(p.name, p.description, p.shortDescription))}</g:description>`)
    lines.push(`      <g:link>${BASE_URL}/en/product/${escapeXml(p.slug)}/</g:link>`)
    lines.push(`      <g:canonical_link>${BASE_URL}/en/product/${escapeXml(p.slug)}/</g:canonical_link>`)
    if (p.images[0]?.url) {
      lines.push(`      <g:image_link>${escapeXml(p.images[0].url)}</g:image_link>`)
      for (const img of p.images.slice(1)) {
        lines.push(`      <g:additional_image_link>${escapeXml(img.url)}</g:additional_image_link>`)
      }
    }
    lines.push(`      <g:availability>${p.availability !== 'out-of-stock' && p.stockCount > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>`)
    lines.push(`      <g:price>${price.toFixed(2)} ${escapeXml(p.currency || 'USD')}</g:price>`)
    if (onSale) {
      lines.push(`      <g:sale_price>${salePrice.toFixed(2)} ${escapeXml(p.currency || 'USD')}</g:sale_price>`)
      // The feed contract is an explicit start/end pair. If either bound is
      // missing, omit the window rather than sending an invalid single date.
      if (p.saleStartsAt && p.saleEndsAt) {
        const window = `${p.saleStartsAt.toISOString()}/${p.saleEndsAt.toISOString()}`
        lines.push(`      <g:sale_price_effective_date>${escapeXml(window)}</g:sale_price_effective_date>`)
      }
    }
    if (brand) lines.push(`      <g:brand>${escapeXml(brand)}</g:brand>`)
    // GTIN only when a verified manufacturer GTIN is stored — never a guessed
    // value, never the IMPA code, never the internal SKU.
    if (validGtin) lines.push(`      <g:gtin>${escapeXml(validGtin)}</g:gtin>`)
    if (mpn) lines.push(`      <g:mpn>${escapeXml(mpn)}</g:mpn>`)
    lines.push(`      <g:condition>${p.condition === 'new' || p.condition === 'unused' ? 'new' : p.condition === 'refurbished' || p.condition === 'reconditioned' ? 'refurbished' : 'used'}</g:condition>`)
    lines.push(`      <g:identifier_exists>${validGtin || mpn ? 'yes' : 'no'}</g:identifier_exists>`)
    if (p.category?.slug) {
      lines.push(`      <g:product_type>${escapeXml(p.category.slug.replace(/-/g, ' > '))}</g:product_type>`)
    }
    // IMPA represented as its own attribute — semantically distinct from GTIN.
    if (impa) lines.push(`      <g:custom_label_0>IMPA ${escapeXml(String(impa).replace(/\s+/g, ''))}</g:custom_label_0>`)
    lines.push('    </item>')
    return lines.join('\n')
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Alka Traders — Merchant Center Feed</title>
    <link>${BASE_URL}</link>
    <description>Marine and industrial equipment product feed</description>
${items.join('\n')}
  </channel>
</rss>`
}

export async function generateFeed(): Promise<string> {
  if (cachedXml && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedXml
  }
  const xml = await buildFeed()
  cachedXml = xml
  cacheTime = Date.now()
  return xml
}
