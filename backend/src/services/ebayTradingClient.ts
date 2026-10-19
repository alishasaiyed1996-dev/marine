/**
 * eBay Trading API client (legacy listings bridge, roadmap C33).
 *
 * The seller's existing (Seller Hub era, cross-listed) listings are invisible
 * to the Inventory API — they can only be read and re-quantified through the
 * XML Trading API. Two calls cover the sync:
 *   - GetMyeBaySelling (ActiveList) — enumerate live listings with SKUs.
 *   - ReviseInventoryStatus — push a quantity to a legacy listing.
 *
 * Auth: the same OAuth user access token used by the REST Sell APIs, sent in
 * the X-EBAY-API-IAF-TOKEN header ("IAF" flow). Responses are flat item
 * summaries parsed with scoped regexes (no XML dependency) — the parsers are
 * pure and unit tested in ebayTradingClient.test.ts.
 */
import logger from '../utils/logger.js'
import { getUserAccessToken, isEbayConfigured } from './ebayClient.js'

const log = logger.child({ context: 'ebay-trading' })

const ENV = (process.env.EBAY_ENV || 'sandbox').toLowerCase()
const TRADING_URL = ENV === 'production' ? 'https://api.ebay.com/ws/api.dll' : 'https://api.sandbox.ebay.com/ws/api.dll'
const COMPATIBILITY_LEVEL = '1271'

/** eBay site domain (from ViewItemURL) → REST-style marketplace id. */
const DOMAIN_TO_MARKETPLACE: Record<string, string> = {
  com: 'EBAY_US',
  ca: 'EBAY_CA',
  'co.uk': 'EBAY_GB',
  'com.au': 'EBAY_AU',
  ie: 'EBAY_IE',
  at: 'EBAY_AT',
  be: 'EBAY_BE',
  ch: 'EBAY_CH',
  de: 'EBAY_DE',
  fr: 'EBAY_FR',
  it: 'EBAY_IT',
  es: 'EBAY_ES',
  nl: 'EBAY_NL',
  pl: 'EBAY_PL',
}

/** Marketplace id → Trading API SiteID (required by ReviseInventoryStatus). */
const MARKETPLACE_TO_SITE_ID: Record<string, string> = {
  EBAY_US: '0',
  EBAY_CA: '2',
  EBAY_GB: '3',
  EBAY_AU: '15',
  EBAY_AT: '16',
  EBAY_BE: '23',
  EBAY_FR: '71',
  EBAY_DE: '77',
  EBAY_IT: '101',
  EBAY_NL: '146',
  EBAY_ES: '186',
  EBAY_CH: '193',
  EBAY_IE: '205',
  EBAY_PL: '212',
}

/** GetMyeBaySelling with SiteID 0 returns the seller's items across sites. */
const SITE_ID_GLOBAL = '0'

export interface LegacyListing {
  itemId: string
  sku: string
  title: string
  /** QuantityAvailable (fallback Quantity) seen on the live listing. */
  quantity: number
  marketplace: string
  viewUrl: string
}

/** Map an eBay item URL like https://www.ebay.co.uk/itm/… to a marketplace id. */
export function marketplaceFromViewUrl(url: string): string | undefined {
  const m = /ebay\.([a-z.]+?)\//i.exec(url)
  if (!m) return undefined
  return DOMAIN_TO_MARKETPLACE[m[1].toLowerCase()]
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

/** Decode XML character/entity references (numeric decimal + hex + named). */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    const named = NAMED_ENTITIES[code]
    if (named !== undefined) return named
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = parseInt(code.slice(2), 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    if (code.startsWith('#')) {
      const n = parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole
    }
    return whole
  })
}

/** Read a single XML leaf element (first occurrence), decoded. */
export function xmlField(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? decodeXmlEntities(m[1]) : undefined
}

/**
 * Parse one GetMyeBaySelling page into item summaries. Pure — exported for
 * tests against a captured live response.
 */
export function parseActiveListingsPage(raw: string): LegacyListing[] {
  const out: LegacyListing[] = []
  const items = raw.match(/<Item>[\s\S]*?<\/Item>/g) || []
  for (const block of items) {
    const itemId = xmlField(block, 'ItemID')
    if (!itemId) continue
    const viewUrl = xmlField(block, 'ViewItemURL') || ''
    out.push({
      itemId,
      sku: (xmlField(block, 'SKU') || '').trim(),
      title: xmlField(block, 'Title') || '',
      quantity: Number(xmlField(block, 'QuantityAvailable') ?? xmlField(block, 'Quantity') ?? '0') || 0,
      marketplace: marketplaceFromViewUrl(viewUrl) || 'EBAY_US',
      viewUrl,
    })
  }
  return out
}

async function tradingCall(callName: string, body: string, siteId: string): Promise<string> {
  if (!isEbayConfigured()) {
    throw Object.assign(new Error('eBay is not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'), { status: 503 })
  }
  const token = await getUserAccessToken()
  const res = await fetch(TRADING_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-IAF-TOKEN': token,
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-SITEID': siteId,
      'X-EBAY-API-COMPATIBILITY-LEVEL': COMPATIBILITY_LEVEL,
      'Content-Type': 'text/xml;charset=utf-8',
    },
    body,
  })
  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    throw Object.assign(new Error(`eBay Trading ${callName} failed (${res.status}): ${raw.slice(0, 200)}`), { status: 502 })
  }
  return raw
}

/** Success OR Warning acks are acceptable (e.g. "quantity revision redundant"). */
function assertTradingAck(callName: string, xml: string): void {
  const ack = xmlField(xml, 'Ack')
  if (ack === 'Success' || ack === 'Warning') return
  const short = xmlField(xml, 'ShortMessage') || xmlField(xml, 'LongMessage') || 'unknown eBay error'
  throw Object.assign(new Error(`eBay Trading ${callName} failed (${ack || 'no Ack'}): ${short.slice(0, 200)}`), { status: 502 })
}

/**
 * Enumerate the seller's LIVE listings across all sites (paged, 200/page).
 */
export async function fetchActiveSellerListings(options: { entriesPerPage?: number; maxPages?: number } = {}): Promise<LegacyListing[]> {
  const entriesPerPage = Math.min(200, Math.max(25, options.entriesPerPage ?? 200))
  const maxPages = Math.max(1, Math.min(60, options.maxPages ?? 60))
  const all: LegacyListing[] = []
  for (let page = 1; page <= maxPages; page++) {
    const xml = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList></GetMyeBaySellingRequest>`
    const raw = await tradingCall('GetMyeBaySelling', xml, SITE_ID_GLOBAL)
    assertTradingAck('GetMyeBaySelling', raw)
    const items = parseActiveListingsPage(raw)
    all.push(...items)
    if (items.length < entriesPerPage) break
    if (page === maxPages) {
      log.warn({ maxPages, scanned: all.length }, 'eBay listing scan hit its page cap — some listings were not read')
    }
  }
  return all
}

/**
 * Push a quantity to a legacy (non Inventory-API) listing. The SiteID must
 * match where the listing lives — mapped from its marketplace.
 */
export async function reviseInventoryStatus(itemId: string, quantity: number, marketplace = 'EBAY_US'): Promise<void> {
  const safeItemId = String(itemId).replace(/\D/g, '')
  if (!safeItemId) {
    throw Object.assign(new Error(`Invalid eBay ItemID: ${String(itemId).slice(0, 20)}`), { status: 400 })
  }
  const qty = Math.max(0, Math.floor(quantity))
  const siteId = MARKETPLACE_TO_SITE_ID[marketplace] ?? SITE_ID_GLOBAL
  const xml = `<?xml version="1.0" encoding="utf-8"?><ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents"><InventoryStatus><ItemID>${safeItemId}</ItemID><Quantity>${qty}</Quantity></InventoryStatus></ReviseInventoryStatusRequest>`
  const raw = await tradingCall('ReviseInventoryStatus', xml, siteId)
  assertTradingAck('ReviseInventoryStatus', raw)
}
