/**
 * eBay payload contract tests.
 * Run: cd backend && npx tsx --test src/services/ebayPayloads.test.ts
 *
 * Offline half of the sandbox validation: these assert the exact bodies the
 * app sends to the Sell Inventory and Trading APIs against eBay's documented
 * required fields. The networked half is
 * src/scripts/validateEbaySandboxPayloads.ts (real sandbox credentials).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
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
} from './ebayPayloads.js'

const policies = {
  merchantLocationKey: 'default-location',
  fulfillmentPolicyId: 'fp-1',
  paymentPolicyId: 'pp-1',
  returnPolicyId: 'rp-1',
}

test('mapListingCondition maps site conditions onto eBay inventory enums', () => {
  assert.equal(mapListingCondition('new'), 'NEW')
  assert.equal(mapListingCondition('unused'), 'NEW')
  assert.equal(mapListingCondition('refurbished'), 'MANUFACTURER_REFURBISHED')
  assert.equal(mapListingCondition('reconditioned'), 'MANUFACTURER_REFURBISHED')
  assert.equal(mapListingCondition('used'), 'USED_EXCELLENT')
})

test('buildOfferPayload produces the documented FIXED_PRICE offer body', () => {
  const payload = buildOfferPayload({
    sku: 'PUMP-001',
    marketplaceId: 'EBAY_US',
    categoryId: '11804',
    price: 129.5,
    currency: 'USD',
    condition: 'USED_EXCELLENT',
    ...policies,
  })
  assert.deepEqual(payload, {
    sku: 'PUMP-001',
    marketplaceId: 'EBAY_US',
    format: 'FIXED_PRICE',
    categoryId: '11804',
    pricingSummary: { price: { value: '129.50', currency: 'USD' } },
    condition: 'USED_EXCELLENT',
    merchantLocationKey: 'default-location',
    fulfillmentPolicyId: 'fp-1',
    paymentPolicyId: 'pp-1',
    returnPolicyId: 'rp-1',
  })
  assert.deepEqual(validateOfferPayload(payload), [])
})

test('validateOfferPayload rejects the fields eBay refuses at create/publish time', () => {
  const base = buildOfferPayload({
    sku: 'SKU-1', marketplaceId: 'EBAY_US', categoryId: '11804',
    price: 10, currency: 'USD', condition: 'NEW', ...policies,
  })

  const problems = validateOfferPayload({
    ...base,
    marketplaceId: 'US',
    categoryId: 'not-a-number',
    pricingSummary: { price: { value: '10', currency: 'usd' } },
    merchantLocationKey: '',
    paymentPolicyId: undefined,
  }).map((problem) => problem.field)
  assert.ok(problems.includes('marketplaceId'))
  assert.ok(problems.includes('categoryId'))
  assert.ok(problems.includes('pricingSummary.price.value'))
  assert.ok(problems.includes('pricingSummary.price.currency'))
  assert.ok(problems.includes('merchantLocationKey'))
  assert.ok(problems.includes('paymentPolicyId'))

  assert.deepEqual(
    validateOfferPayload({ ...base, pricingSummary: { price: { value: '0.00', currency: 'USD' } } })
      .map((problem) => problem.field),
    ['pricingSummary.price.value'],
  )
})

test('buildInventoryItemPayload normalizes quantity, drops non-http images and empty aspects', () => {
  const payload = buildInventoryItemPayload({
    quantity: 3.9,
    condition: 'NEW',
    title: 'Hydraulic pump',
    description: 'Test item',
    imageUrls: ['https://i.ebayimg.com/a.jpg', 'ftp://nope/a.jpg'],
    aspects: { Brand: ['Rexroth'], Empty: [] },
  })
  assert.deepEqual(payload, {
    availability: { shipToLocationAvailability: { quantity: 3 } },
    condition: 'NEW',
    product: {
      title: 'Hydraulic pump',
      description: 'Test item',
      imageUrls: ['https://i.ebayimg.com/a.jpg'],
      aspects: { Brand: ['Rexroth'] },
    },
  })
  assert.deepEqual(validateInventoryItemPayload(payload), [])
})

test('validateInventoryItemPayload catches the publish-blocking problems', () => {
  const problems = validateInventoryItemPayload({
    availability: { shipToLocationAvailability: { quantity: -1 } },
    condition: 'REFURBISHED' as never, // not an Inventory API enum
    product: {
      title: 'x'.repeat(81),
      description: '',
      imageUrls: ['http://insecure.example/a.jpg'],
      aspects: { Brand: [] },
    },
  }).map((problem) => problem.field)

  assert.ok(problems.includes('availability.shipToLocationAvailability.quantity'))
  assert.ok(problems.includes('condition'))
  assert.ok(problems.includes('product.title'))
  assert.ok(problems.includes('product.description'))
  assert.ok(problems.includes('product.imageUrls[0]'))
  assert.ok(problems.includes('product.aspects.Brand'))
})

test('buildOfferQuantityPayload preserves availability settings and sets the quantity', () => {
  const payload = buildOfferQuantityPayload(
    {
      sku: 'SKU-1',
      marketplaceId: 'EBAY_US',
      format: ['FIXED_PRICE'],
      availability: { shipToLocationAvailability: { quantity: 4, allocationThreshold: 1 } },
    },
    9.8,
  )
  assert.deepEqual(payload, {
    sku: 'SKU-1',
    marketplaceId: 'EBAY_US',
    format: ['FIXED_PRICE'],
    availability: { shipToLocationAvailability: { allocationThreshold: 1, quantity: 9 } },
  })
  assert.deepEqual(validateOfferQuantityPayload(payload, 9), [])

  const mismatch = validateOfferQuantityPayload(payload, 4).map((problem) => problem.field)
  assert.deepEqual(mismatch, ['availability.shipToLocationAvailability.quantity'])
})

test('buildOfferQuantityPayload defaults a missing format and clamps invalid quantities', () => {
  const payload = buildOfferQuantityPayload({ sku: 'S', marketplaceId: 'EBAY_GB' }, Number.NaN)
  assert.equal(payload.format, 'FIXED_PRICE')
  assert.equal(payload.availability.shipToLocationAvailability.quantity, 0)
  assert.deepEqual(validateOfferQuantityPayload(payload), [])
})

test('buildReviseInventoryStatusRequest carries the item id + whole quantity and escapes XML', () => {
  const xml = buildReviseInventoryStatusRequest('itm&<>"\'x', 7.9)
  assert.match(xml, /<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">/)
  assert.match(xml, /<ItemID>itm&amp;&lt;&gt;&quot;&apos;x<\/ItemID>/)
  assert.match(xml, /<Quantity>7<\/Quantity>/)
  assert.deepEqual(validateReviseInventoryStatusRequest(xml, { itemId: 'itm&<>"\'x', quantity: 7 }), [])

  const problems = validateReviseInventoryStatusRequest(
    buildReviseInventoryStatusRequest('ITEM-1', 2),
    { itemId: 'ITEM-2', quantity: 5 },
  ).map((problem) => problem.field)
  assert.deepEqual(problems, ['InventoryStatus.ItemID', 'InventoryStatus.Quantity'])
})

test('validateReviseInventoryStatusRequest rejects a malformed Trading body', () => {
  const problems = validateReviseInventoryStatusRequest('<ReviseInventoryStatusRequest><Quantity>lots</Quantity>', {
    itemId: 'ITEM-1',
    quantity: 1,
  }).map((problem) => problem.field)
  assert.ok(problems.includes('InventoryStatus.ItemID'))
  assert.ok(problems.includes('InventoryStatus.Quantity'))
})
