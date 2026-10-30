/**
 * eBay write payloads — builders + contract validation.
 *
 * Pure module (no prisma / server import) for one reason: the exact bytes the
 * app sends to eBay must be assertable in tests and replayable against the
 * sandbox. Everything that creates or updates inventory on eBay goes through
 * here:
 *
 *   - Sell Inventory API: buildInventoryItemPayload / buildOfferPayload
 *     (listing creation) and buildOfferQuantityPayload (quantity update)
 *   - Trading API: buildReviseInventoryStatusRequest (quantity write for
 *     listings imported from the eBay UI, which have no offer id)
 *
 * The validate* functions encode eBay's documented required fields. They are
 * used by src/scripts/validateEbaySandboxPayloads.ts before/after a real
 * sandbox round-trip and by ebayPayloads.test.ts offline, so a payload
 * regression fails fast instead of surfacing as a 4xx from eBay.
 */

/** Condition values this app writes (Sell Inventory API enum subset). */
export const EBAY_INVENTORY_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'NEW_OTHER',
  'NEW_WITH_DEFECTS',
  'MANUFACTURER_REFURBISHED',
  'CERTIFIED_REFURBISHED',
  'EXCELLENT_REFURBISHED',
  'SELLER_REFURBISHED',
  'USED_EXCELLENT',
  'USED_VERY_GOOD',
  'USED_GOOD',
  'USED_ACCEPTABLE',
  'FOR_PARTS_OR_NOT_WORKING',
] as const

export type EbayInventoryCondition = (typeof EBAY_INVENTORY_CONDITIONS)[number]

/** Central catalog condition → eBay inventory condition. */
export function mapListingCondition(condition: string): EbayInventoryCondition {
  switch (condition) {
    case 'new':
    case 'unused': return 'NEW'
    case 'refurbished':
    case 'reconditioned': return 'MANUFACTURER_REFURBISHED'
    default: return 'USED_EXCELLENT'
  }
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Quantities eBay accepts: whole units, never negative. */
export function normalizeQuantity(quantity: number): number {
  return Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0))
}

// ─── Sell Inventory API: inventory item ────────────────────────

export interface InventoryItemPayload {
  availability: { shipToLocationAvailability: { quantity: number } }
  condition: EbayInventoryCondition
  product: {
    title: string
    description: string
    imageUrls?: string[]
    aspects?: Record<string, string[]>
  }
}

export function buildInventoryItemPayload(input: {
  quantity: number
  condition: EbayInventoryCondition
  title: string
  description: string
  imageUrls?: string[]
  aspects?: Record<string, string[]>
}): InventoryItemPayload {
  const imageUrls = (input.imageUrls || []).filter((url) => /^https?:\/\//.test(url))
  const aspects = Object.fromEntries(
    Object.entries(input.aspects || {}).filter(([, values]) => values.length > 0),
  )
  return {
    availability: { shipToLocationAvailability: { quantity: normalizeQuantity(input.quantity) } },
    condition: input.condition,
    product: {
      title: input.title,
      description: input.description,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(Object.keys(aspects).length > 0 ? { aspects } : {}),
    },
  }
}

// ─── Sell Inventory API: offer ─────────────────────────────────

export interface OfferPayload {
  sku: string
  marketplaceId: string
  format: 'FIXED_PRICE'
  categoryId: string
  pricingSummary: { price: { value: string; currency: string } }
  condition: EbayInventoryCondition
  merchantLocationKey: string | undefined
  fulfillmentPolicyId: string | undefined
  paymentPolicyId: string | undefined
  returnPolicyId: string | undefined
}

export interface OfferPayloadInput {
  sku: string
  marketplaceId: string
  categoryId: string
  price: number
  currency: string
  condition: EbayInventoryCondition
  merchantLocationKey?: string
  fulfillmentPolicyId?: string
  paymentPolicyId?: string
  returnPolicyId?: string
}

export function buildOfferPayload(input: OfferPayloadInput): OfferPayload {
  return {
    sku: input.sku,
    marketplaceId: input.marketplaceId,
    format: 'FIXED_PRICE',
    categoryId: input.categoryId,
    // eBay requires the offer price as a decimal string with 2 places.
    pricingSummary: { price: { value: input.price.toFixed(2), currency: input.currency } },
    condition: input.condition,
    merchantLocationKey: input.merchantLocationKey,
    fulfillmentPolicyId: input.fulfillmentPolicyId,
    paymentPolicyId: input.paymentPolicyId,
    returnPolicyId: input.returnPolicyId,
  }
}

export interface OfferQuantityPayload {
  sku: string
  marketplaceId: string
  format: string | string[]
  availability: {
    shipToLocationAvailability: {
      quantity: number
      allocationThreshold?: number
    }
  }
}

/**
 * Quantity half of an offer update (get-modify-write). Existing availability
 * settings such as allocationThreshold are preserved — eBay rejects a PUT that
 * drops a threshold the seller configured.
 */
export function buildOfferQuantityPayload(
  offer: {
    sku: string
    marketplaceId: string
    format?: string | string[]
    availability?: { shipToLocationAvailability?: { quantity?: number; allocationThreshold?: number } }
  },
  quantity: number,
): OfferQuantityPayload {
  return {
    sku: offer.sku,
    marketplaceId: offer.marketplaceId,
    format: offer.format || 'FIXED_PRICE',
    availability: {
      shipToLocationAvailability: {
        ...(offer.availability?.shipToLocationAvailability || {}),
        quantity: normalizeQuantity(quantity),
      },
    },
  }
}

// ─── Trading API: ReviseInventoryStatus ────────────────────────

/**
 * Quantity write for listings without an Inventory API offer id (created in
 * the eBay UI or through the Trading API). Deliberately carries only the
 * fields a quantity revision needs: item id + quantity.
 */
export function buildReviseInventoryStatusRequest(itemId: string, quantity: number): string {
  const safeQuantity = normalizeQuantity(quantity)
  return `
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <InventoryStatus>
    <ItemID>${xmlEscape(itemId)}</ItemID>
    <Quantity>${safeQuantity}</Quantity>
  </InventoryStatus>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
</ReviseInventoryStatusRequest>`
}

// ─── Contract validation ───────────────────────────────────────

export interface PayloadProblem {
  field: string
  message: string
}

const MARKETPLACE_ID = /^EBAY_[A-Z]{2}$/
const CURRENCY_CODE = /^[A-Z]{3}$/
const DECIMAL_2 = /^\d+\.\d{2}$/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateInventoryItemPayload(payload: InventoryItemPayload): PayloadProblem[] {
  const problems: PayloadProblem[] = []
  const quantity = payload?.availability?.shipToLocationAvailability?.quantity
  if (!Number.isInteger(quantity) || (quantity as number) < 0) {
    problems.push({ field: 'availability.shipToLocationAvailability.quantity', message: 'must be a whole number ≥ 0' })
  }
  if (!EBAY_INVENTORY_CONDITIONS.includes(payload?.condition)) {
    problems.push({ field: 'condition', message: `must be one of ${EBAY_INVENTORY_CONDITIONS.join(', ')}` })
  }
  const title = payload?.product?.title
  if (!isNonEmptyString(title)) {
    problems.push({ field: 'product.title', message: 'is required' })
  } else if (title.length > 80) {
    problems.push({ field: 'product.title', message: 'must be ≤ 80 characters (eBay truncates/rejects longer titles)' })
  }
  const description = payload?.product?.description
  if (!isNonEmptyString(description)) {
    problems.push({ field: 'product.description', message: 'is required' })
  } else if (description.length > 4000) {
    problems.push({ field: 'product.description', message: 'must be ≤ 4000 characters' })
  }
  for (const [index, url] of (payload?.product?.imageUrls || []).entries()) {
    if (!/^https:\/\//.test(url)) {
      problems.push({ field: `product.imageUrls[${index}]`, message: 'must be an https URL' })
    }
  }
  for (const [name, values] of Object.entries(payload?.product?.aspects || {})) {
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => !isNonEmptyString(value))) {
      problems.push({ field: `product.aspects.${name}`, message: 'must be a non-empty list of non-empty strings' })
    }
  }
  return problems
}

export function validateOfferPayload(payload: OfferPayload): PayloadProblem[] {
  const problems: PayloadProblem[] = []
  if (!isNonEmptyString(payload?.sku)) problems.push({ field: 'sku', message: 'is required' })
  if (!MARKETPLACE_ID.test(payload?.marketplaceId || '')) {
    problems.push({ field: 'marketplaceId', message: 'must look like EBAY_US / EBAY_GB' })
  }
  if (payload?.format !== 'FIXED_PRICE') {
    problems.push({ field: 'format', message: 'must be FIXED_PRICE' })
  }
  if (!/^\d+$/.test(payload?.categoryId || '')) {
    problems.push({ field: 'categoryId', message: 'must be a numeric eBay category id' })
  }
  const price = payload?.pricingSummary?.price
  if (!price || !DECIMAL_2.test(price.value || '')) {
    problems.push({ field: 'pricingSummary.price.value', message: 'must be a decimal string with 2 fraction digits' })
  } else if (Number(price.value) <= 0) {
    problems.push({ field: 'pricingSummary.price.value', message: 'must be greater than 0' })
  }
  if (!CURRENCY_CODE.test(price?.currency || '')) {
    problems.push({ field: 'pricingSummary.price.currency', message: 'must be a 3-letter ISO currency code' })
  }
  if (!EBAY_INVENTORY_CONDITIONS.includes(payload?.condition)) {
    problems.push({ field: 'condition', message: `must be one of ${EBAY_INVENTORY_CONDITIONS.join(', ')}` })
  }
  for (const field of ['merchantLocationKey', 'fulfillmentPolicyId', 'paymentPolicyId', 'returnPolicyId'] as const) {
    if (!isNonEmptyString(payload?.[field])) {
      problems.push({ field, message: 'is required — eBay rejects offers without the account business policy' })
    }
  }
  return problems
}

export function validateOfferQuantityPayload(
  payload: OfferQuantityPayload,
  expectedQuantity?: number,
): PayloadProblem[] {
  const problems: PayloadProblem[] = []
  if (!isNonEmptyString(payload?.sku)) problems.push({ field: 'sku', message: 'is required' })
  if (!MARKETPLACE_ID.test(payload?.marketplaceId || '')) {
    problems.push({ field: 'marketplaceId', message: 'must look like EBAY_US / EBAY_GB' })
  }
  const format = Array.isArray(payload?.format) ? payload.format : [payload?.format]
  if (!format.includes('FIXED_PRICE')) {
    problems.push({ field: 'format', message: 'must include FIXED_PRICE' })
  }
  const quantity = payload?.availability?.shipToLocationAvailability?.quantity
  if (!Number.isInteger(quantity) || (quantity as number) < 0) {
    problems.push({ field: 'availability.shipToLocationAvailability.quantity', message: 'must be a whole number ≥ 0' })
  } else if (expectedQuantity !== undefined && quantity !== expectedQuantity) {
    problems.push({
      field: 'availability.shipToLocationAvailability.quantity',
      message: `expected ${expectedQuantity}, got ${quantity}`,
    })
  }
  return problems
}

/** Offline check of the Trading API quantity request (no network needed). */
export function validateReviseInventoryStatusRequest(
  xml: string,
  expected: { itemId: string; quantity: number },
): PayloadProblem[] {
  const problems: PayloadProblem[] = []
  if (!/<ReviseInventoryStatusRequest[\s>]/.test(xml)) {
    problems.push({ field: 'root', message: 'must contain <ReviseInventoryStatusRequest>' })
  }
  const itemMatch = /<ItemID>([^<]*)<\/ItemID>/.exec(xml)
  if (!itemMatch) {
    problems.push({ field: 'InventoryStatus.ItemID', message: 'is required' })
  } else if (itemMatch[1] !== xmlEscape(expected.itemId)) {
    problems.push({ field: 'InventoryStatus.ItemID', message: `expected ${expected.itemId}, got ${itemMatch[1]}` })
  }
  const quantityMatch = /<Quantity>([^<]*)<\/Quantity>/.exec(xml)
  if (!quantityMatch) {
    problems.push({ field: 'InventoryStatus.Quantity', message: 'is required' })
  } else if (!/^\d+$/.test(quantityMatch[1])) {
    problems.push({ field: 'InventoryStatus.Quantity', message: 'must be a whole number' })
  } else if (Number(quantityMatch[1]) !== normalizeQuantity(expected.quantity)) {
    problems.push({
      field: 'InventoryStatus.Quantity',
      message: `expected ${normalizeQuantity(expected.quantity)}, got ${quantityMatch[1]}`,
    })
  }
  return problems
}
