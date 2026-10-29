/**
 * Pure eBay → website catalog mapping rules.
 *
 * Kept separate from ebayCatalogImportService so unit tests can exercise the
 * rules without importing the server bootstrap (which starts HTTP listeners).
 */
import type { EbayItemDetails, EbayItemSpecific } from './ebayTradingService.js'
import {
  categoryIdForSlug,
  resolveWebsiteCategory,
  type CategoryAssignment,
  type CategorySourceInput,
} from './ebayCategoryMapping.js'

export const MAX_DESCRIPTION_CHARS = 20_000

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()
    try {
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16))
      if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10))
    } catch {
      return match
    }
    return HTML_ENTITIES[key] ?? match
  })
}

/**
 * eBay descriptions are arbitrary seller HTML. The storefront renders product
 * descriptions as plain text, so strip markup while keeping paragraph/list
 * boundaries readable for the existing description parser.
 */
export function htmlToPlainText(value: string | null | undefined): string {
  if (!value) return ''
  const text = value
    .replace(/<\s*(script|style|noscript)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|table|section|article|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*\/\s*td\s*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')

  return decodeHtmlEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS)
}

export function cleanTitle(value: string | null | undefined): string {
  return decodeHtmlEntities(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

export function normalizeEbaySku(sku: string | null | undefined, itemId: string): string {
  const cleaned = String(sku || '').trim().replace(/\s+/g, ' ')
  return (cleaned || `EBAY-${itemId}`).slice(0, 100)
}

export type WebsiteCondition = 'new' | 'unused' | 'used' | 'refurbished' | 'reconditioned'

/**
 * One row's condition decision, pure so the sweep, the backfill script and
 * the test suite share it. `product` is an eBay-imported row;
 * `ebayConditionRaw` is the seller-stated condition as eBay words it
 * ("Used - Very Good", "For parts or not working", a numeric Id when the
 * display name is absent). Returns the write to make or null when the row
 * already mirrors eBay:
 *
 *   - condition column disagrees with mapEbayCondition(raw) → import it.
 *   - the stored note words a different condition class than eBay's → refresh
 *     it (stale default from old imports misreads the page, e.g. note "New
 *     other" on a row eBay says is Used).
 *   - no note at all → record eBay's exact wording (the page shows it).
 */
export function planConditionUpdate(
  product: { condition: string; conditionNotes: string | null },
  ebayConditionRaw: string | null | undefined,
): { condition: WebsiteCondition; conditionNotes: string | null } | null {
  if (!ebayConditionRaw) return null
  const mapped = mapEbayCondition(ebayConditionRaw)
  const notes = (product.conditionNotes || '').trim()
  if (mapped !== product.condition) return { condition: mapped, conditionNotes: ebayConditionRaw }
  if (notes && mapEbayCondition(notes) !== mapped) return { condition: mapped, conditionNotes: ebayConditionRaw }
  if (!notes) return { condition: mapped, conditionNotes: ebayConditionRaw }
  return null
}

/**
 * eBay ConditionDisplayName → site condition. When the display name is absent
 * the parse falls back to the numeric ConditionID, so those are mapped too:
 * 1000 New · 1500 New other · 1750 New with defects · 2000/2500/3000/3500
 * refurb family · 4000/5000/6000 used family · 7000 For parts or not working.
 * Anything unrecognized defaults to 'used' — the conservative reading for an
 * industrial-parts storefront (never oversell a used part as new).
 */
export function mapEbayCondition(condition: string | null | undefined): WebsiteCondition {
  const value = String(condition || '').trim().toLowerCase()
  if (/^\d+$/.test(value)) {
    const id = Number(value)
    if (id < 1750) return id <= 1000 ? 'new' : 'unused'
    if (id < 2000) return 'unused' // New with defects
    if (id <= 3500) return 'refurbished'
    return 'used'
  }
  if (/refurb|recondition/.test(value)) return 'refurbished'
  if (/new\s*(other|with\s*defects)|like\s*new|open\s*box|new\s*without\s*tags/.test(value)) return 'unused'
  if (/(^new\b|brand\s*new)/.test(value)) return 'new'
  return 'used'
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pickSpecific(specifics: EbayItemSpecific[], keys: string[]): string | null {
  const wanted = keys.map(normalizeKey)
  for (const spec of specifics) {
    if (!wanted.includes(normalizeKey(spec.name))) continue
    const value = spec.value.trim()
    if (value) return value
  }
  return null
}

export function validGtin(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : null
}

export interface EbayIdentity {
  manufacturer: string | null
  mpn: string | null
  modelNumber: string | null
  gtin: string | null
  impaCode: string | null
}

function limitText(value: string | null, max: number): string | null {
  return value ? value.slice(0, max) : null
}

export function extractIdentity(specifics: EbayItemSpecific[]): EbayIdentity {
  // Respect the catalog column limits; a single over-long eBay specific must
  // not make the whole product insert fail.
  return {
    manufacturer: limitText(pickSpecific(specifics, ['brand', 'manufacturer', 'make']), 255),
    mpn: limitText(pickSpecific(specifics, ['mpn', 'manufacturer part number', 'part number', 'manufacturer part number mpn']), 100),
    modelNumber: limitText(pickSpecific(specifics, ['model', 'model number']), 100),
    gtin: validGtin(pickSpecific(specifics, ['gtin', 'upc', 'ean', 'isbn'])),
    impaCode: limitText(pickSpecific(specifics, ['impa', 'impa code']), 50),
  }
}

export function buildSeoTitle(title: string): string | null {
  const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, 70)
  return cleaned || null
}

export function buildSeoDescription(input: {
  title: string
  condition?: string | null
  manufacturer?: string | null
  description?: string | null
}): string | null {
  const title = input.title.replace(/\s+/g, ' ').trim()
  const condition = input.condition ? ` in ${input.condition} condition` : ''
  const manufacturer = input.manufacturer ? ` by ${input.manufacturer}` : ''
  const base = `${title}${manufacturer}${condition}.`
  const snippet = String(input.description || '').replace(/\s+/g, ' ').trim()
  let text = `${base} ${snippet}`.trim()
  if (text.length < 80) text = `${text} Available from Alka Traders.`.trim()
  if (text.length < 80) return null
  if (text.length > 160) text = `${text.slice(0, 157).replace(/\s+\S*$/, '').trim()}…`
  return text
}

export function buildShortDescription(description: string | null, title: string): string {
  const text = String(description || '').replace(/\s+/g, ' ').trim()
  if (!text) return title.slice(0, 300)
  const sentence = text.match(/^.{20,300}?[.!?](?:\s|$)/)?.[0] || text
  return sentence.slice(0, 300).trim()
}

export function buildDescription(plainDescription: string, details: EbayItemDetails): string | null {
  const parts: string[] = []
  if (details.condition) parts.push(`Condition: ${details.condition}`)
  if (plainDescription) parts.push(plainDescription)
  if (!plainDescription && details.specifics.length > 0) {
    parts.push(details.specifics.slice(0, 20).map((spec) => `${spec.name}: ${spec.value}`).join('\n'))
  }
  const combined = parts.join('\n\n').trim()
  return combined ? combined.slice(0, MAX_DESCRIPTION_CHARS) : null
}

export function normalizeCurrency(value: string | null | undefined): string {
  const currency = String(value || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD'
}

/**
 * eBay → website category resolution.
 *
 * The whole rule set lives in `ebayCategoryMapping.ts` (aliased by eBay
 * category name, then ordered keyword rules over title/specifics, then the
 * 'other-business' fallback). Here we only bind the resolved slug to a live
 * Category row id, so callers get one call that answers
 * "which categoryId does this listing belong to and why".
 */
export function resolveCategoryId(
  source: CategorySourceInput,
  categories: Array<{ id: string; slug?: string | null; name: string }>,
): { categoryId: string | null; assignment: CategoryAssignment } {
  const assignment = resolveWebsiteCategory(source)
  return { categoryId: categoryIdForSlug(assignment.slug, categories), assignment }
}

export function matchBrandId(
  manufacturer: string | null | undefined,
  brands: Array<{ id: string; name: string }>,
): string | null {
  const target = normalizeKey(String(manufacturer || ''))
  if (!target) return null
  return brands.find((brand) => normalizeKey(brand.name) === target)?.id ?? null
}
