/**
 * Trading API (legacy listings bridge) pure-helper tests (roadmap C33).
 * Run: cd backend && npx tsx --test src/services/ebayTradingClient.test.ts
 *
 * node:test, matching the project's pure-module test convention. Network
 * calls are NOT tested here — the parsers below are pinned against a
 * realistic GetMyeBaySelling response shape (captured live, Oct 2026).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { marketplaceFromViewUrl, decodeXmlEntities, xmlField, parseActiveListingsPage } from './ebayTradingClient.js'

// ── marketplaceFromViewUrl ─────────────────────────────────────

test('marketplaceFromViewUrl maps eBay site domains to marketplace ids', () => {
  assert.equal(marketplaceFromViewUrl('https://www.ebay.com/itm/376843710591'), 'EBAY_US')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.co.uk/itm/123456'), 'EBAY_GB')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.com.au/itm/123456'), 'EBAY_AU')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.de/itm/123456'), 'EBAY_DE')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.fr/itm/123456'), 'EBAY_FR')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.it/itm/123456'), 'EBAY_IT')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.es/itm/123456'), 'EBAY_ES')
  assert.equal(marketplaceFromViewUrl('https://www.ebay.ca/itm/123456'), 'EBAY_CA')
  assert.equal(marketplaceFromViewUrl('not a url'), undefined)
})

// ── decodeXmlEntities ──────────────────────────────────────────

test('decodeXmlEntities decodes named, decimal and hex entities', () => {
  assert.equal(decodeXmlEntities('Pump &amp; Seal &#39;kit&#39;'), "Pump & Seal 'kit'")
  assert.equal(decodeXmlEntities('&#x27;hex&#x2F;slash'), "'hex/slash")
  assert.equal(decodeXmlEntities('&unknown; stays'), '&unknown; stays')
})

// ── xmlField ───────────────────────────────────────────────────

test('xmlField extracts and decodes a single leaf element', () => {
  assert.equal(xmlField('<ItemID>376843710591</ItemID>', 'ItemID'), '376843710591')
  assert.equal(xmlField('<SKU>Z 40</SKU>', 'SKU'), 'Z 40')
  assert.equal(xmlField('<Title>WIKA &amp; Gauge</Title>', 'Title'), 'WIKA & Gauge')
  assert.equal(xmlField('<Ack>Success</Ack>', 'Missing'), undefined)
})

// ── parseActiveListingsPage ────────────────────────────────────

test('parseActiveListingsPage extracts item summaries with per-site marketplaces', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><ActiveList><ItemArray><Item><ItemID>376714523998</ItemID><SKU> C 126 </SKU><Title>WIKA Thermometer &amp; Gauge</Title><Quantity>3</Quantity><QuantityAvailable>2</QuantityAvailable><ListingDetails><ViewItemURL>https://www.ebay.fr/itm/WIKA-376714523998</ViewItemURL></ListingDetails></Item><Item><ItemID>377281099160</ItemID><SKU>E 206</SKU><Title>Relay</Title><Quantity>3</Quantity><QuantityAvailable>3</QuantityAvailable><ListingDetails><ViewItemURL>https://www.ebay.ca/itm/377281099160</ViewItemURL></ListingDetails></Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`
  const items = parseActiveListingsPage(xml)
  assert.equal(items.length, 2)
  assert.deepEqual(items[0], {
    itemId: '376714523998',
    sku: 'C 126',
    title: 'WIKA Thermometer & Gauge',
    quantity: 2,
    marketplace: 'EBAY_FR',
    viewUrl: 'https://www.ebay.fr/itm/WIKA-376714523998',
  })
  assert.equal(items[1].itemId, '377281099160')
  assert.equal(items[1].sku, 'E 206')
  assert.equal(items[1].marketplace, 'EBAY_CA')
})

test('parseActiveListingsPage falls back to Quantity when QuantityAvailable is absent', () => {
  const xml = '<ItemArray><Item><ItemID>111</ItemID><SKU>S 1</SKU><Quantity>5</Quantity><ListingDetails><ViewItemURL>https://www.ebay.com/itm/111</ViewItemURL></ListingDetails></Item></ItemArray>'
  const items = parseActiveListingsPage(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 5)
  assert.equal(items[0].marketplace, 'EBAY_US')
})

test('parseActiveListingsPage skips items without an ItemID', () => {
  const xml = '<ItemArray><Item><SKU>NOPE</SKU></Item></ItemArray>'
  assert.deepEqual(parseActiveListingsPage(xml), [])
})
