/**
 * Tax-country contract test.
 *
 * The checkout estimate (src/lib/tax.ts) and the authoritative charge
 * (backend/src/utils/country.ts) must agree on what "domestic" means. The
 * server is authoritative, but a drift here makes the review screen show tax
 * the server will not charge (or hide tax it will charge).
 *
 * The matrix deliberately includes names, ISO codes and the "UK" alias, which
 * is two characters but is not the ISO code for the United Kingdom ("GB").
 *
 * Run: cd backend && npm test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isDomesticCountry as serverIsDomesticCountry,
  normalizeCountry as serverNormalizeCountry,
} from '../utils/country.js'
import {
  isDomesticCountry as clientIsDomesticCountry,
  normalizeCountry as clientNormalizeCountry,
} from '../../../src/lib/tax.js'

const domesticPairs: Array<[string, string]> = [
  ['IN', 'India'],
  ['India', 'IN'],
  ['US', 'United States'],
  ['USA', 'US'],
  ['GB', 'UK'],
  ['UK', 'GB'],
  ['United Kingdom', 'GB'],
  ['DE', 'Germany'],
  ['AE', 'UAE'],
  ['United Arab Emirates', 'AE'],
  ['SA', 'Saudi Arabia'],
]

const foreignPairs: Array<[string, string]> = [
  ['IN', 'US'],
  ['US', 'India'],
  ['DE', 'France'],
  ['', 'IN'],
  ['IN', ''],
]

test('server and storefront agree that aliases and names identify the domestic country', () => {
  for (const [shipping, store] of domesticPairs) {
    assert.equal(serverIsDomesticCountry(shipping, store), true, `server: ${shipping} / ${store}`)
    assert.equal(clientIsDomesticCountry(shipping, store), true, `client: ${shipping} / ${store}`)
    assert.equal(clientNormalizeCountry(shipping), serverNormalizeCountry(shipping), `normalize ${shipping}`)
    assert.equal(clientNormalizeCountry(store), serverNormalizeCountry(store), `normalize ${store}`)
  }
})

test('server and storefront agree that different countries are not domestic', () => {
  for (const [shipping, store] of foreignPairs) {
    assert.equal(serverIsDomesticCountry(shipping, store), false, `server: ${shipping} / ${store}`)
    assert.equal(clientIsDomesticCountry(shipping, store), false, `client: ${shipping} / ${store}`)
  }
})
