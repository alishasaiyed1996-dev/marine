/**
 * Read-only eBay active listing import.
 *
 * The Sell Inventory API only exposes listings created through the Inventory
 * API. Sellers can also list through the eBay UI or the Trading API, so the
 * admin "Active eBay Listings" view uses GetMyeBaySelling (Trading API) to
 * pull every active listing on the account. This is intentionally read-only:
 * importing 8k+ marketplace duplicates into the website catalog would be
 * destructive, and a local product is not required just to view eBay data.
 */
import type { Prisma } from '@prisma/client'
import { XMLParser } from 'fast-xml-parser'
import { prisma } from '../server.js'
import logger from '../utils/logger.js'
import { getUserAccessToken } from './ebayClient.js'

const log = logger.child({ context: 'ebay-active-listings' })
const TRADING_API_VERSION = '967'
const PAGE_SIZE_MAX = 100

export interface ActiveEbayListing {
  itemId: string | null
  title: string | null
  sku: string | null
  quantity: number
  price: number | null
  currency: string | null
  originalPrice: number | null
  originalCurrency: string | null
  listingUrl: string | null
  imageUrl: string | null
  categoryId: string | null
  categoryName: string | null
  condition: string | null
  listingType: string | null
  marketplace: string
  startTime: string | null
  endTime: string | null
  watchCount: number | null
  linkedProduct: {
    id: string
    slug: string
    sku: string
    status: string
  } | null
}

export interface ActiveEbayListingsResult extends Record<string, unknown> {
  listings: ActiveEbayListing[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  fetchedAt: string
}

function xmlText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return xmlText((value as Record<string, unknown>)['#text'])
  }
  return null
}

function xmlNumber(value: unknown): number | null {
  const text = xmlText(value)
  if (text == null) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function xmlArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function money(value: unknown): { amount: number | null; currency: string | null } {
  if (value == null || typeof value !== 'object') return { amount: null, currency: null }
  const record = value as Record<string, unknown>
  const currency = typeof record['@_currencyID'] === 'string' ? record['@_currencyID'] : null
  return { amount: xmlNumber(record['#text']), currency }
}

function marketplaceFromUrl(url: string | null): string {
  if (!url) return 'EBAY_US'
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('ebay.co.uk')) return 'EBAY_GB'
    if (host.endsWith('ebay.de')) return 'EBAY_DE'
    if (host.endsWith('ebay.fr')) return 'EBAY_FR'
    if (host.endsWith('ebay.it')) return 'EBAY_IT'
    if (host.endsWith('ebay.es')) return 'EBAY_ES'
    if (host.endsWith('ebay.ca')) return 'EBAY_CA'
    if (host.endsWith('ebay.com.au')) return 'EBAY_AU'
    if (host.endsWith('ebay.com')) return 'EBAY_US'
  } catch {
    // Fall through to the default marketplace.
  }
  return 'EBAY_US'
}

function tradingErrors(value: unknown): string[] {
  return xmlArray(value).map((entry) => {
    const record = entry as Record<string, unknown>
    return (
      xmlText(record.LongMessage) ||
      xmlText(record.ShortMessage) ||
      `eBay error ${xmlText(record.ErrorCode) || 'unknown'}`
    )
  })
}

function parseActiveItem(input: unknown): ActiveEbayListing {
  const item = (input || {}) as Record<string, any>
  const listingDetails = (item.ListingDetails || {}) as Record<string, any>
  const sellingStatus = (item.SellingStatus || {}) as Record<string, any>
  const pictureDetails = (item.PictureDetails || {}) as Record<string, any>
  const primaryCategory = (item.PrimaryCategory || {}) as Record<string, any>

  const listingUrl = xmlText(listingDetails.ViewItemURL)
  const current = money(sellingStatus.CurrentPrice)
  const converted = money(sellingStatus.ConvertedCurrentPrice)
  const linkedPictures = xmlArray(pictureDetails.PictureURL).map((value) => xmlText(value)).filter(Boolean)

  return {
    itemId: xmlText(item.ItemID),
    title: xmlText(item.Title),
    sku: xmlText(item.SKU),
    quantity: xmlNumber(item.QuantityAvailable) ?? xmlNumber(item.Quantity) ?? 0,
    price: converted.amount ?? current.amount,
    currency: converted.currency ?? current.currency,
    originalPrice: current.amount,
    originalCurrency: current.currency,
    listingUrl,
    imageUrl: xmlText(pictureDetails.GalleryURL) || linkedPictures[0] || null,
    categoryId: xmlText(primaryCategory.CategoryID),
    categoryName: xmlText(primaryCategory.CategoryName),
    condition: xmlText(item.ConditionDisplayName) || xmlText(item.ConditionID),
    listingType: xmlText(item.ListingType),
    marketplace: marketplaceFromUrl(listingUrl),
    startTime: xmlText(listingDetails.StartTime),
    endTime: xmlText(listingDetails.EndTime),
    watchCount: xmlNumber(item.WatchCount),
    linkedProduct: null,
  }
}

async function attachLinkedProducts(listings: ActiveEbayListing[]): Promise<ActiveEbayListing[]> {
  const itemIds = [...new Set(listings.map((listing) => listing.itemId).filter((value): value is string => Boolean(value)))]
  const skus = [...new Set(listings.map((listing) => listing.sku).filter((value): value is string => Boolean(value)))]
  if (itemIds.length === 0 && skus.length === 0) return listings

  const listingConditions: Prisma.EbayListingWhereInput[] = []
  if (itemIds.length > 0) listingConditions.push({ ebayListingId: { in: itemIds } })
  if (skus.length > 0) listingConditions.push({ sku: { in: skus } })

  const [ebayLinks, products] = await Promise.all([
    listingConditions.length > 0
      ? prisma.ebayListing.findMany({
          where: { OR: listingConditions },
          select: {
            ebayListingId: true,
            sku: true,
            product: { select: { id: true, slug: true, sku: true, status: true } },
          },
        })
      : Promise.resolve([]),
    skus.length > 0
      ? prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { id: true, slug: true, sku: true, status: true },
        })
      : Promise.resolve([]),
  ])

  const byListingId = new Map<string, { id: string; slug: string; sku: string; status: string }>()
  const bySku = new Map<string, { id: string; slug: string; sku: string; status: string }>()

  for (const link of ebayLinks) {
    if (link.ebayListingId) byListingId.set(link.ebayListingId, link.product)
    if (link.sku) bySku.set(link.sku, link.product)
  }
  for (const product of products) {
    if (product.sku) bySku.set(product.sku, product)
  }

  return listings.map((listing) => ({
    ...listing,
    linkedProduct:
      (listing.itemId ? byListingId.get(listing.itemId) : undefined) ||
      (listing.sku ? bySku.get(listing.sku) : undefined) ||
      null,
  }))
}

export async function getActiveEbayListings(options: { page?: number; limit?: number } = {}): Promise<ActiveEbayListingsResult> {
  const page = Math.max(1, Math.floor(options.page || 1))
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(options.limit || 50)))
  const env = (process.env.EBAY_ENV || 'sandbox').toLowerCase()
  const endpoint = env === 'production'
    ? 'https://api.ebay.com/ws/api.dll'
    : 'https://api.sandbox.ebay.com/ws/api.dll'
  const token = await getUserAccessToken()

  const request = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>${limit}</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</GetMyeBaySellingRequest>`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-SITEID': process.env.EBAY_SITE_ID || '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': TRADING_API_VERSION,
        'X-EBAY-API-IAF-TOKEN': token,
      },
      body: request,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw Object.assign(new Error(`eBay active listing request failed: ${(error as Error).message}`), { status: 502 })
  }
  const raw = await response.text().catch(() => '')
  if (!response.ok) {
    throw Object.assign(new Error(`eBay active listing request failed (${response.status}): ${raw.slice(0, 200)}`), { status: 502 })
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: true,
  })
  let parsed: any
  try {
    parsed = parser.parse(raw)
  } catch (error) {
    throw Object.assign(new Error(`eBay active listing response was not valid XML: ${(error as Error).message}`), { status: 502 })
  }

  const result = parsed?.GetMyeBaySellingResponse
  const ack = xmlText(result?.Ack)
  const errors = tradingErrors(result?.Errors)
  if (ack === 'Failure') {
    throw Object.assign(new Error(errors.join('; ') || 'eBay rejected the active listing request'), { status: 502 })
  }

  const active = result?.ActiveList
  const rawItems = xmlArray(active?.ItemArray?.Item)
  const listings = rawItems.map(parseActiveItem)
  const total = xmlNumber(active?.PaginationResult?.TotalNumberOfEntries) ?? listings.length
  const totalPages = xmlNumber(active?.PaginationResult?.TotalNumberOfPages) ?? Math.ceil(total / limit)
  const withLinks = await attachLinkedProducts(listings)

  log.info({ page, limit, total, returned: withLinks.length, env }, 'eBay active listings fetched')
  return {
    listings: withLinks,
    pagination: { page, limit, total, totalPages },
    fetchedAt: new Date().toISOString(),
  }
}
