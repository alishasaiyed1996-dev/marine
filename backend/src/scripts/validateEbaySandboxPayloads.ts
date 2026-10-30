/**
 * eBay sandbox payload validation (offer + quantity writes).
 *
 * Validates the EXACT payloads this app sends to eBay against the real
 * sandbox API using the configured credentials:
 *
 *   1. offline contract checks (no network): every builder is validated
 *      against eBay's documented required fields — the same validators the
 *      unit tests use, so a failure here is a payload bug, not a network one;
 *   2. sandbox round-trip: create a throwaway inventory item + FIXED_PRICE
 *      offer with the real builders, read both back and assert what eBay
 *      stored (quantity, price, category, marketplace, policies);
 *   3. quantity write: PUT the offer quantity with the shared builder, read it
 *      back and assert eBay accepted the new number;
 *   4. Trading API envelope: send the generated ReviseInventoryStatus request
 *      and confirm eBay parsed it (it may reject the unknown test item id —
 *      that is fine, an XML/schema error is not).
 *
 * Safety: refuses to run against production and cleans up the test offer +
 * inventory item unless --keep is passed.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/validateEbaySandboxPayloads.ts            # full run
 *   npx tsx src/scripts/validateEbaySandboxPayloads.ts --dry-run  # offline only
 *   npx tsx src/scripts/validateEbaySandboxPayloads.ts --publish  # also publish
 *   npx tsx src/scripts/validateEbaySandboxPayloads.ts --json     # machine-readable
 *
 * Env: EBAY_ENV (must not be production), EBAY_CLIENT_ID / SECRET /
 * EBAY_REFRESH_TOKEN, EBAY_MERCHANT_LOCATION_KEY + the three policy ids.
 * Optional: EBAY_VALIDATION_CATEGORY_ID (default 9355), EBAY_VALIDATION_CURRENCY
 * (default USD).
 */
import 'dotenv/config'
import { getUserAccessToken } from '../services/ebayClient.js'
import {
  buildInventoryItemPayload,
  buildOfferPayload,
  buildOfferQuantityPayload,
  buildReviseInventoryStatusRequest,
  mapListingCondition,
  validateInventoryItemPayload,
  validateOfferPayload,
  validateOfferQuantityPayload,
  validateReviseInventoryStatusRequest,
} from '../services/ebayPayloads.js'

const EBAY_ENV = (process.env.EBAY_ENV || 'sandbox').toLowerCase()
const API_BASE = EBAY_ENV === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
const TRADING_ENDPOINT = `${API_BASE}/ws/api.dll`

const ARGS = new Set(process.argv.slice(2))
const DRY_RUN = ARGS.has('--dry-run')
const KEEP = ARGS.has('--keep')
const PUBLISH = ARGS.has('--publish')
const JSON_OUTPUT = ARGS.has('--json')

const CATEGORY_ID = process.env.EBAY_VALIDATION_CATEGORY_ID || '9355'
const CURRENCY = (process.env.EBAY_VALIDATION_CURRENCY || 'USD').toUpperCase()
const MARKETPLACE = 'EBAY_US'
const TEST_SKU = `SBX-VALIDATE-${Date.now().toString(36)}`.toUpperCase().slice(0, 50)
const TEST_TITLE = 'Sandbox payload validation item'
const TEST_DESCRIPTION = 'Throwaway inventory item created by the eBay payload validator. Safe to ignore.'
const INITIAL_QUANTITY = 3
const UPDATED_QUANTITY = 7

interface Check {
  name: string
  ok: boolean
  detail: string
}

const checks: Check[] = []

function record(name: string, problems: Array<{ field: string; message: string }> | true, detail?: string): boolean {
  const ok = problems === true || problems.length === 0
  checks.push({
    name,
    ok,
    detail: problems === true ? (detail || 'ok') : problems.map((problem) => `${problem.field}: ${problem.message}`).join('; '),
  })
  return ok
}

function accountConfig(): { merchantLocationKey: string; fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string } {
  return {
    merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || '',
    fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || '',
    paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || '',
    returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || '',
  }
}

function missingCredentials(): string[] {
  return ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_REFRESH_TOKEN']
    .filter((key) => !process.env[key])
}

// ─── Offline contract checks ───────────────────────────────────

function offlineChecks(): void {
  const policies = accountConfig()
  const offer = buildOfferPayload({
    sku: TEST_SKU,
    marketplaceId: MARKETPLACE,
    categoryId: CATEGORY_ID,
    price: 19.99,
    currency: CURRENCY,
    condition: mapListingCondition('used'),
    merchantLocationKey: policies.merchantLocationKey || 'preflight-merchant-location',
    fulfillmentPolicyId: policies.fulfillmentPolicyId || 'preflight-fulfillment-policy',
    paymentPolicyId: policies.paymentPolicyId || 'preflight-payment-policy',
    returnPolicyId: policies.returnPolicyId || 'preflight-return-policy',
  })
  record('offer payload contract', validateOfferPayload(offer))

  const item = buildInventoryItemPayload({
    quantity: INITIAL_QUANTITY,
    condition: mapListingCondition('used'),
    title: TEST_TITLE,
    description: TEST_DESCRIPTION,
  })
  record('inventory item payload contract', validateInventoryItemPayload(item))

  const quantityPayload = buildOfferQuantityPayload(
    { sku: offer.sku, marketplaceId: offer.marketplaceId, format: offer.format },
    UPDATED_QUANTITY,
  )
  record('offer quantity payload contract', validateOfferQuantityPayload(quantityPayload, UPDATED_QUANTITY))

  const reviseXml = buildReviseInventoryStatusRequest('110000000001', UPDATED_QUANTITY)
  record(
    'Trading ReviseInventoryStatus request contract',
    validateReviseInventoryStatusRequest(reviseXml, { itemId: '110000000001', quantity: UPDATED_QUANTITY }),
  )
}

// ─── Sandbox round-trip ────────────────────────────────────────

async function ebayFetch(path: string, token: string, init: RequestInit = {}): Promise<{ status: number; ok: boolean; raw: string }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US',
      ...(init.headers || {}),
    },
  })
  const raw = await response.text().catch(() => '')
  return { status: response.status, ok: response.ok, raw }
}

function parseJson(raw: string): Record<string, any> {
  try { return (JSON.parse(raw) as Record<string, any>) || {} } catch { return {} }
}

async function tradingEnvelopeCheck(token: string): Promise<void> {
  const itemId = `1100000${Date.now().toString().slice(-6)}`
  const body = `<?xml version="1.0" encoding="utf-8"?>\n${buildReviseInventoryStatusRequest(itemId, 1)}`
  let raw: string
  try {
    const response = await fetch(TRADING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
        'X-EBAY-API-SITEID': process.env.EBAY_SITE_ID || '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-IAF-TOKEN': token,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    raw = await response.text().catch(() => '')
  } catch (error) {
    record('Trading ReviseInventoryStatus envelope', [{ field: 'transport', message: (error as Error).message }])
    return
  }

  // An unknown ItemID is expected and means eBay parsed the request. Only a
  // parse/schema complaint is a payload problem.
  const schemaProblem = /invalid xml|schema|unexpected element|not well.?formed|cannot parse/i.test(raw)
  record(
    'Trading ReviseInventoryStatus envelope',
    schemaProblem
      ? [{ field: 'response', message: raw.replace(/\s+/g, ' ').slice(0, 400) }]
      : true,
    /Ack>Failure</i.test(raw)
      ? 'eBay parsed the request and rejected the unknown test item id (expected)'
      : 'eBay accepted the request envelope',
  )
}

let createdOfferId: string | null = null
let inventoryItemCreated = false
let publishedListingId: string | null = null

async function cleanup(token: string): Promise<void> {
  if (KEEP) {
    checks.push({
      name: 'cleanup',
      ok: true,
      detail: `--keep set: left offer ${createdOfferId || 'none'} / SKU ${TEST_SKU} on the sandbox account`,
    })
    return
  }
  if (createdOfferId && !publishedListingId) {
    const res = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(createdOfferId)}`, token, { method: 'DELETE' })
    if (!res.ok) checks.push({ name: 'cleanup offer', ok: false, detail: `${res.status}: ${res.raw.slice(0, 200)}` })
  }
  if (inventoryItemCreated) {
    const res = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(TEST_SKU)}`, token, { method: 'DELETE' })
    if (!res.ok) checks.push({ name: 'cleanup inventory item', ok: false, detail: `${res.status}: ${res.raw.slice(0, 200)}` })
  }
  if (publishedListingId) {
    checks.push({
      name: 'cleanup published listing',
      ok: true,
      detail: `published sandbox listing ${publishedListingId} left in place — end it manually or rerun without --publish`,
    })
  }
}

async function sandboxRoundTrip(): Promise<void> {
  const policies = accountConfig()
  const token = await getUserAccessToken()
  record('sandbox OAuth user token', true, `minted against ${EBAY_ENV}`)

  // 1. Inventory item — the offer cannot exist without it.
  const itemPayload = buildInventoryItemPayload({
    quantity: INITIAL_QUANTITY,
    condition: mapListingCondition('used'),
    title: TEST_TITLE,
    description: TEST_DESCRIPTION,
  })
  const itemWrite = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(TEST_SKU)}`, token, {
    method: 'PUT',
    body: JSON.stringify(itemPayload),
  })
  const itemWriteOk = record(
    'create inventory item (sandbox PUT)',
    itemWrite.ok ? true : [{ field: 'response', message: `${itemWrite.status}: ${itemWrite.raw.slice(0, 500)}` }],
  )
  inventoryItemCreated = itemWrite.ok
  if (!itemWriteOk) return

  const itemRead = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(TEST_SKU)}`, token)
  const itemData = parseJson(itemRead.raw)
  const storedQuantity = itemData?.availability?.shipToLocationAvailability?.quantity
  const storedCondition = itemData?.condition
  const itemReadProblems: Array<{ field: string; message: string }> = []
  if (!itemRead.ok) itemReadProblems.push({ field: 'response', message: `${itemRead.status}: ${itemRead.raw.slice(0, 300)}` })
  if (storedQuantity !== INITIAL_QUANTITY) {
    itemReadProblems.push({ field: 'availability.shipToLocationAvailability.quantity', message: `expected ${INITIAL_QUANTITY}, eBay stored ${String(storedQuantity)}` })
  }
  if (storedCondition !== itemPayload.condition) {
    itemReadProblems.push({ field: 'condition', message: `expected ${itemPayload.condition}, eBay stored ${String(storedCondition)}` })
  }
  record('read back inventory item (sandbox GET)', itemReadProblems)

  // 2. Offer — the exact body listing creation sends.
  const offerPayload = buildOfferPayload({
    sku: TEST_SKU,
    marketplaceId: MARKETPLACE,
    categoryId: CATEGORY_ID,
    price: 19.99,
    currency: CURRENCY,
    condition: mapListingCondition('used'),
    ...policies,
  })
  const offerWrite = await ebayFetch('/sell/inventory/v1/offer/', token, {
    method: 'POST',
    body: JSON.stringify(offerPayload),
  })
  const offerData = parseJson(offerWrite.raw)
  const offerWriteOk = record(
    'create offer (sandbox POST)',
    offerWrite.ok && typeof offerData.offerId === 'string'
      ? true
      : [{ field: 'response', message: `${offerWrite.status}: ${offerWrite.raw.slice(0, 800)}` }],
    `offerId ${String(offerData.offerId)}`,
  )
  createdOfferId = typeof offerData.offerId === 'string' ? offerData.offerId : null
  if (!offerWriteOk || !createdOfferId) return

  const offerRead = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(createdOfferId)}`, token)
  const readBack = parseJson(offerRead.raw)
  const readProblems: Array<{ field: string; message: string }> = []
  if (!offerRead.ok) readProblems.push({ field: 'response', message: `${offerRead.status}: ${offerRead.raw.slice(0, 300)}` })
  if (readBack.sku !== TEST_SKU) readProblems.push({ field: 'sku', message: `expected ${TEST_SKU}, eBay reports ${String(readBack.sku)}` })
  if (readBack.marketplaceId !== MARKETPLACE) readProblems.push({ field: 'marketplaceId', message: `expected ${MARKETPLACE}, eBay reports ${String(readBack.marketplaceId)}` })
  if (String(readBack.categoryId) !== CATEGORY_ID) readProblems.push({ field: 'categoryId', message: `expected ${CATEGORY_ID}, eBay reports ${String(readBack.categoryId)}` })
  if (readBack.pricingSummary?.price?.value !== '19.99') {
    readProblems.push({ field: 'pricingSummary.price.value', message: `expected 19.99, eBay reports ${String(readBack.pricingSummary?.price?.value)}` })
  }
  if (!String(readBack.pricingSummary?.price?.currency)?.toUpperCase().startsWith(CURRENCY)) {
    readProblems.push({ field: 'pricingSummary.price.currency', message: `expected ${CURRENCY}, eBay reports ${String(readBack.pricingSummary?.price?.currency)}` })
  }
  const readPolicies = readBack.listingPolicies || {}
  if (readPolicies.fulfillmentPolicyId !== policies.fulfillmentPolicyId) {
    readProblems.push({ field: 'listingPolicies.fulfillmentPolicyId', message: `expected ${policies.fulfillmentPolicyId}, eBay reports ${String(readPolicies.fulfillmentPolicyId)}` })
  }
  if (readPolicies.paymentPolicyId !== policies.paymentPolicyId) {
    readProblems.push({ field: 'listingPolicies.paymentPolicyId', message: `expected ${policies.paymentPolicyId}, eBay reports ${String(readPolicies.paymentPolicyId)}` })
  }
  if (readPolicies.returnPolicyId !== policies.returnPolicyId) {
    readProblems.push({ field: 'listingPolicies.returnPolicyId', message: `expected ${policies.returnPolicyId}, eBay reports ${String(readPolicies.returnPolicyId)}` })
  }
  if (readBack.merchantLocationKey !== policies.merchantLocationKey) {
    readProblems.push({ field: 'merchantLocationKey', message: `expected ${policies.merchantLocationKey}, eBay reports ${String(readBack.merchantLocationKey)}` })
  }
  record('read back offer (sandbox GET)', readProblems)

  // 3. Quantity write — the exact update payload the sync scheduler sends.
  const quantityPayload = buildOfferQuantityPayload(
    {
      sku: readBack.sku || TEST_SKU,
      marketplaceId: readBack.marketplaceId || MARKETPLACE,
      format: readBack.format || 'FIXED_PRICE',
      availability: readBack.availability,
    },
    UPDATED_QUANTITY,
  )
  const quantityWrite = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(createdOfferId)}`, token, {
    method: 'PUT',
    body: JSON.stringify(quantityPayload),
  })
  const quantityWriteOk = record(
    'update offer quantity (sandbox PUT)',
    quantityWrite.ok ? true : [{ field: 'response', message: `${quantityWrite.status}: ${quantityWrite.raw.slice(0, 500)}` }],
  )
  if (quantityWriteOk) {
    const quantityRead = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(createdOfferId)}`, token)
    const after = parseJson(quantityRead.raw)
    const stored = after?.availability?.shipToLocationAvailability?.quantity
    record(
      'read back offer quantity (sandbox GET)',
      stored === UPDATED_QUANTITY
        ? true
        : [{ field: 'availability.shipToLocationAvailability.quantity', message: `expected ${UPDATED_QUANTITY}, eBay stored ${String(stored)}` }],
    )
  }

  // 4. Optional publish, so the Trading quantity write targets a live item.
  if (PUBLISH) {
    const publish = await ebayFetch(`/sell/inventory/v1/offer/${encodeURIComponent(createdOfferId)}/publish`, token, { method: 'POST' })
    const published = parseJson(publish.raw)
    publishedListingId = typeof published.listingId === 'string' ? published.listingId : null
    record(
      'publish offer (sandbox POST)',
      publish.ok && publishedListingId
        ? true
        : [{ field: 'response', message: `${publish.status}: ${publish.raw.slice(0, 800)}` }],
      publishedListingId ? `listingId ${publishedListingId}` : 'no listingId returned',
    )
  }

  await tradingEnvelopeCheck(token)
  await cleanup(token)
}

// ─── main ──────────────────────────────────────────────────────

function printReport(): void {
  const failed = checks.filter((check) => !check.ok)
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ env: EBAY_ENV, sku: TEST_SKU, offerId: createdOfferId, checks, failed: failed.length }, null, 2)}\n`)
    return
  }
  process.stdout.write(`\neBay ${EBAY_ENV} payload validation — SKU ${TEST_SKU}\n`)
  process.stdout.write(`${'─'.repeat(72)}\n`)
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}\n      ${check.detail}\n`)
  }
  process.stdout.write(`${'─'.repeat(72)}\n`)
  process.stdout.write(failed.length === 0 ? 'All payload checks passed.\n' : `${failed.length} check(s) failed.\n`)
}

async function main(): Promise<number> {
  if (EBAY_ENV === 'production' && !DRY_RUN) {
    process.stderr.write('Refusing to run: EBAY_ENV=production. This validator only writes to the sandbox.\n')
    process.stderr.write('Set EBAY_ENV=sandbox (with sandbox credentials) or use --dry-run for the offline checks.\n')
    return 2
  }

  offlineChecks()

  const missingCreds = missingCredentials()
  const policies = accountConfig()
  const missingPolicies = Object.entries(policies).filter(([, value]) => !value).map(([key]) => key)

  if (EBAY_ENV === 'production') {
    checks.push({
      name: 'sandbox round-trip',
      ok: true,
      detail: 'SKIPPED — EBAY_ENV=production; this validator never writes outside the sandbox. Run with EBAY_ENV=sandbox and sandbox credentials.',
    })
  } else if (!DRY_RUN && (missingCreds.length > 0 || missingPolicies.length > 0)) {
    checks.push({
      name: 'sandbox round-trip',
      ok: true,
      detail: `SKIPPED — missing ${[...missingCreds, ...missingPolicies].join(', ')}. Offline contract checks ran; set the env vars and rerun for the live check.`,
    })
  } else if (!DRY_RUN) {
    try {
      await sandboxRoundTrip()
    } catch (error) {
      record('sandbox round-trip', [{ field: 'exception', message: (error as Error).message }])
    }
  } else {
    checks.push({ name: 'sandbox round-trip', ok: true, detail: 'SKIPPED — --dry-run' })
  }

  printReport()
  return checks.every((check) => check.ok) ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`Validation crashed: ${(error as Error).message}\n`)
    process.exit(1)
  })
