/**
 * eBay REST API client (roadmap C).
 *
 * Auth: Sell Inventory (offer read/update) and Fulfillment (order read) calls
 * authenticate with a USER access token minted from EBAY_REFRESH_TOKEN via the
 * refresh-token grant — eBay rejects app-only (client-credentials) tokens on
 * Sell APIs. getClientToken() remains for public read APIs (Browse/Taxonomy).
 * Both token types are cached in memory and refreshed at 90% of lifetime.
 * Sandboxed via EBAY_ENV=sandbox. All credentials come from env — never
 * hard-coded.
 *
 * API model verified against current eBay docs (Sep 2026):
 *  - Offer quantity lives at availability.shipToLocationAvailability.quantity
 *    and is updated via PUT /sell/inventory/v1/offer/{offerId} (get-modify-write).
 *  - Orders: GET /sell/fulfillment/v1/order/{orderId}.
 *
 * Modernized GraphQL gateway (Oct 2026): the Inventory Mapping API (listing
 * previews) posts to https://graphqlapi.ebay.com/graphql with the SAME user
 * token refresh grant, but the OAuth request must carry the extra
 * `sell.inventory.mapping` scope. Because an eBay refresh-token grant only
 * accepts scopes the refresh token was granted at mint time, the mapping
 * token is minted SEPARATELY (getMappingUserAccessToken): until the admin
 * re-mints EBAY_REFRESH_TOKEN with that scope, every other eBay call keeps
 * working and only the GraphQL mapping calls report a clear 503.
 */
import logger from '../utils/logger.js'
import { buildOfferQuantityPayload } from './ebayPayloads.js'

const log = logger.child({ context: 'ebay-client' })

const ENV = (process.env.EBAY_ENV || 'sandbox').toLowerCase()
const API_BASE = ENV === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
const OAUTH_URL = `${ENV === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'}/identity/v1/oauth2/token`
const SCOPE = 'https://api.ebay.com/oauth/api_scope'
/** Modernized GraphQL gateway (Inventory Mapping etc.). Sandbox mirrors it. */
const GRAPHQL_URL = `${ENV === 'production' ? 'https://graphqlapi.ebay.com' : 'https://graphqlapi.sandbox.ebay.com'}/graphql`

/** True when Sell API calls can authenticate (app credentials + user token). */
export function isEbayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_REFRESH_TOKEN)
}

// ── OAuth token cache ──────────────────────────────────────────
let cachedToken: string | null = null
let tokenExpiresAt = 0

export async function getClientToken(): Promise<string> {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw Object.assign(new Error('eBay app credentials missing (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)'), { status: 503 })
  }
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(new Error(`eBay OAuth failed (${res.status}): ${body.slice(0, 200)}`), { status: 502 })
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = data.access_token
  // Refresh at 90% of lifetime to survive clock skew.
  tokenExpiresAt = Date.now() + Math.floor(data.expires_in * 0.9) * 1000
  log.info({ env: ENV, expiresIn: data.expires_in }, 'eBay OAuth token acquired')
  return cachedToken!
}

// ── User access token (refresh-token grant) ────────────────────

// Scopes granted to the user token when it was minted via the developer
// portal ("User Tokens" → Get a User Token). The refresh grant must request
// a subset of the granted scopes.
const USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
]

let cachedUserToken: string | null = null
let userTokenExpiresAt = 0

/** User-context token for Sell APIs; requires EBAY_REFRESH_TOKEN. */
export async function getUserAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  const refreshToken = process.env.EBAY_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(new Error('eBay user token not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'), { status: 503 })
  }
  if (cachedUserToken && Date.now() < userTokenExpiresAt) return cachedUserToken

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: USER_SCOPES.join(' ') }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(new Error(`eBay user OAuth failed (${res.status}): ${body.slice(0, 200)}`), { status: 502 })
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedUserToken = data.access_token
  userTokenExpiresAt = Date.now() + Math.floor(data.expires_in * 0.9) * 1000
  log.info({ env: ENV, expiresIn: data.expires_in }, 'eBay user access token acquired')
  return cachedUserToken!
}

/** GraphQL Inventory Mapping scope (replaces the REST inventory-scoping for
 *  listing previews). Requires a refresh token minted WITH this scope. */
const MAPPING_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory.mapping'
const MAPPING_USER_SCOPES = [...USER_SCOPES, MAPPING_SCOPE]

let cachedMappingToken: string | null = null
let mappingTokenExpiresAt = 0

/**
 * User token for the GraphQL Inventory Mapping API. Minted against the
 * MAPPING_USER_SCOPES set; when the stored refresh token predates that scope
 * eBay rejects the grant (invalid_scope) and we surface a concrete
 * re-mint instruction — every REST call keeps working in the meantime.
 */
export async function getMappingUserAccessToken(): Promise<string> {
  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  const refreshToken = process.env.EBAY_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(new Error('eBay user token not configured (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN missing)'), { status: 503 })
  }
  if (cachedMappingToken && Date.now() < mappingTokenExpiresAt) return cachedMappingToken

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: MAPPING_USER_SCOPES.join(' ') }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const invalidScope = /invalid_scope|scope/i.test(body)
    throw Object.assign(
      new Error(
        invalidScope
          ? `eBay OAuth rejected the sell.inventory.mapping scope (${res.status}) — re-mint EBAY_REFRESH_TOKEN with that scope in the developer portal (User Tokens → scopes), see docs/ebay-listing-previews.md`
          : `eBay user OAuth failed (${res.status}): ${body.slice(0, 200)}`,
      ),
      { status: 503 },
    )
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedMappingToken = data.access_token
  mappingTokenExpiresAt = Date.now() + Math.floor(data.expires_in * 0.9) * 1000
  log.info({ env: ENV, expiresIn: data.expires_in }, 'eBay GraphQL mapping access token acquired')
  return cachedMappingToken!
}

/**
 * Marketplace selector for the Inventory Mapping API. The API rules: US
 * marketplace only (eBay Motors excluded) and the marketplace is chosen by
 * the X-EBAY-C-MARKETPLACE-ID header, NOT an input field.
 */
const MAPPING_MARKETPLACE = 'EBAY_US'

/**
 * POST a GraphQL operation to the modernized gateway. Authentication equals
 * the REST layer (Bearer user token) plus the mapping-specific marketplace
 * header. `errors` in a 200 body is a GraphQL error surface, not an HTTP
 * failure — normalize everything to an Error with the first message so
 * callers keep their existing status-carrying error convention.
 */
export async function graphqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  operationName?: string,
): Promise<T> {
  const token = await getMappingUserAccessToken()
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Documented marketplace selection for the Inventory Mapping API
      // ("Set the marketplace by including the X-EBAY-C-MARKETPLACE-ID
      // header with the value EBAY_US").
      'X-EBAY-C-MARKETPLACE-ID': MAPPING_MARKETPLACE,
    },
    body: JSON.stringify({ query, variables, ...(operationName ? { operationName } : {}) }),
  })
  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    throw Object.assign(new Error(`eBay GraphQL failed (${res.status}): ${raw.slice(0, 300)}`), { status: res.status })
  }
  type GraphqlResponseBody = { data?: T; errors?: Array<{ message?: string; path?: (string | number)[] }> }
  let body: GraphqlResponseBody | null = null
  try { body = raw ? (JSON.parse(raw) as GraphqlResponseBody) : null } catch { /* malformed */ }
  if (!body) {
    throw Object.assign(new Error(`eBay GraphQL returned an unreadable body: ${raw.slice(0, 200)}`), { status: 502 })
  }
  if (body.errors && body.errors.length > 0) {
    const message = body.errors.map((e) => e?.message || JSON.stringify(e)).join('; ').slice(0, 300)
    throw Object.assign(new Error(`eBay GraphQL error: ${message}`), { status: 502 })
  }
  if (!body.data) {
    throw Object.assign(new Error('eBay GraphQL response carried no data'), { status: 502 })
  }
  return body.data
}

async function ebayFetch<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const token = await getUserAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const raw = await res.text().catch(() => '')
  let data: T | null = null
  try { data = raw ? JSON.parse(raw) as T : null } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data, raw }
}

// ── Inventory API: offers ──────────────────────────────────────

interface EbayOffer {
  offerId: string
  sku: string
  marketplaceId: string
  status: string
  format?: string[]
  availability?: {
    shipToLocationAvailability?: { quantity?: number; allocationThreshold?: number }
  }
}

/** All live/published offers for a SKU on a marketplace. */
export async function getOffersBySku(sku: string, marketplaceId = 'EBAY_US'): Promise<EbayOffer[]> {
  const res = await ebayFetch<{ offers?: EbayOffer[]; total?: number }>(
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${marketplaceId}&limit=100`,
  )
  if (!res.ok) {
    throw Object.assign(new Error(`eBay getOffers failed (${res.status}): ${res.raw.slice(0, 200)}`), { status: res.status })
  }
  return (res.data?.offers || []).filter((o) => o.status === 'ACTIVE' || o.status === 'PUBLISHED')
}

/**
 * Set quantity on the inventory item (get-modify-write). The current eBay
 * model may require quantity on BOTH the inventory item and its live offer
 * depending on listing type — the sync applies both; eBay honours the one
 * that applies and ignores the other.
 */
export async function updateInventoryItemQuantity(sku: string, quantity: number): Promise<void> {
  const current = await ebayFetch<Record<string, unknown>>(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`)
  if (!current.ok || !current.data) {
    throw Object.assign(new Error(`eBay getInventoryItem failed (${current.status}): ${current.raw.slice(0, 200)}`), { status: current.status })
  }
  const item = current.data
  const payload = {
    ...item,
    availability: {
      ...(item.availability as object || {}),
      shipToLocationAvailability: {
        ...((item.availability as { shipToLocationAvailability?: object })?.shipToLocationAvailability || {}),
        quantity,
      },
    },
  }
  const res = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw Object.assign(new Error(`eBay updateInventoryItem failed (${res.status}): ${res.raw.slice(0, 300)}`), { status: res.status })
  }
}

/**
 * Set the purchasable quantity on a live offer (get-modify-write, per the
 * current Inventory API model: quantity lives on the offer's
 * shipToLocationAvailability for FIXED_PRICE offers).
 */
export async function updateOfferQuantity(offerId: string, quantity: number): Promise<void> {
  const current = await ebayFetch<EbayOffer>(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`)
  if (!current.ok || !current.data) {
    throw Object.assign(new Error(`eBay getOffer failed (${current.status}): ${current.raw.slice(0, 200)}`), { status: current.status })
  }
  const offer = current.data
  // Shared builder (ebayPayloads.ts): preserves allocationThreshold and the
  // existing format while setting the purchasable quantity.
  const payload = buildOfferQuantityPayload(offer, quantity)
  const res = await ebayFetch<{ offerId?: string }>(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw Object.assign(new Error(`eBay updateOffer failed (${res.status}): ${res.raw.slice(0, 300)}`), { status: res.status })
  }
}

// ── Fulfillment API: orders ────────────────────────────────────

export interface EbayApiOrder {
  orderId: string
  creationDate?: string
  orderPaymentStatus?: string
  orderFulfillmentStatus?: string
  total?: { value?: string; currency?: string }
  lineItems?: Array<{
    lineItemId: string
    sku?: string
    quantity?: number
    title?: string
    lineItemCost?: { value?: string }
  }>
}

export async function getOrder(ebayOrderId: string): Promise<EbayApiOrder> {
  const res = await ebayFetch<EbayApiOrder>(`/sell/fulfillment/v1/order/${encodeURIComponent(ebayOrderId)}`)
  if (!res.ok) {
    throw Object.assign(new Error(`eBay getOrder failed (${res.status}): ${res.raw.slice(0, 200)}`), { status: res.status })
  }
  if (!res.data) throw new Error('eBay getOrder returned an empty body')
  return res.data
}

/**
 * List orders created after the given ISO timestamp (Fulfillment API). Used
 * by the webhook-gap poll job — see pollEbayOrders in ebayOrderService.
 */
export async function listOrdersSince(sinceIso: string, limit = 100): Promise<EbayApiOrder[]> {
  const params = new URLSearchParams({
    filter: `creationdate:[${sinceIso}..]`,
    limit: String(Math.min(200, Math.max(1, limit))),
    sort: 'creationdate',
  })
  const res = await ebayFetch<{ orders?: EbayApiOrder[] }>(`/sell/fulfillment/v1/order?${params.toString()}`)
  if (!res.ok) {
    throw Object.assign(new Error(`eBay listOrders failed (${res.status}): ${res.raw.slice(0, 200)}`), { status: res.status })
  }
  return res.data?.orders || []
}

// ── Error classification (retry policy) ────────────────────────

/** Retryable = temporary. Permanent validation errors must NOT retry forever. */
export function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\(5\d\d\)/.test(msg) || /\(429\)/.test(msg)) return true
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) return true
  if (/OAuth failed \(401\)|token|invalid_grant/i.test(msg)) return true // auth can be re-acquired
  return false
}
