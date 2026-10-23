/**
 * Pricing contract test.
 *
 * The checkout estimate (src/lib/shipping.ts) and the authoritative charge
 * (backend/src/utils/shipping.ts) are two implementations of the same rules.
 * The server is authoritative — the client value is never trusted — but if the
 * two drift, the customer sees one freight on the review screen and is
 * charged another. That is the "money math is inconsistent" finding.
 *
 * This test imports BOTH implementations and asserts they agree on a matrix of
 * carts, countries, and zone configurations, including the countries that are
 * not in the storefront's short country list.
 *
 * Run: cd backend && npm test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calcShippingCost as serverCalcShippingCost,
  findZoneForCountry as serverFindZone,
  parseShippingZones as serverParseZones,
} from '../utils/shipping.js'
import {
  calcShippingCost as clientCalcShippingCost,
  findZoneForCountry as clientFindZone,
  parseShippingZones as clientParseZones,
} from '../../../src/lib/shipping.js'

interface Zone {
  id?: string
  name?: string
  regions?: string[]
  rateType?: string
  flatRate?: number
  freeThreshold?: number
  estimatedDays?: string
  active?: boolean
}

const zone = (overrides: Partial<Zone>): Zone => ({
  name: 'Test zone',
  regions: ['US'],
  rateType: 'flat',
  flatRate: 12.5,
  freeThreshold: 0,
  active: true,
  ...overrides,
})

/** The default admin zones (src/pages/admin/settings/types.ts). */
const DEFAULT_ZONES: Zone[] = [
  { id: 'z1', name: 'UAE / GCC', regions: ['UAE', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Oman'], rateType: 'flat', flatRate: 50, freeThreshold: 2000, estimatedDays: '3–5 business days', active: true },
  { id: 'z2', name: 'South Asia', regions: ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka'], rateType: 'flat', flatRate: 120, freeThreshold: 5000, estimatedDays: '7–14 business days', active: true },
  { id: 'z3', name: 'Southeast Asia', regions: ['Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines'], rateType: 'flat', flatRate: 150, freeThreshold: 5000, estimatedDays: '10–18 business days', active: true },
  { id: 'z4', name: 'Europe', regions: ['Netherlands', 'Germany', 'UK', 'France', 'Spain', 'Italy'], rateType: 'flat', flatRate: 200, freeThreshold: 10000, estimatedDays: '14–21 business days', active: true },
  { id: 'z5', name: 'North America', regions: ['USA', 'Canada', 'Mexico'], rateType: 'flat', flatRate: 220, freeThreshold: 10000, estimatedDays: '14–21 business days', active: true },
  { id: 'z6', name: 'East Asia', regions: ['China', 'Japan', 'South Korea', 'Taiwan'], rateType: 'flat', flatRate: 180, freeThreshold: 7500, estimatedDays: '10–18 business days', active: true },
]

const COUNTRIES = [
  'IN', 'SG', 'AE', 'NL', 'DE', 'GB', 'US', 'JP', 'CN', 'KR', 'SA', 'QA',
  'NG', 'ZA', 'BR', 'AU', 'NO', 'DK',
  // Not in the storefront's short country list — resolved through ICU.
  'IT', 'FR', 'ES', 'MX', 'CA', 'PK', 'MY', 'ID', 'PH', 'VN', 'TH',
]

const SUBTOTALS = [0, 1, 99.99, 100, 100.01, 999.99, 2000, 5000, 10000, 25000]

test('client and server agree on the shipping cost for every country and cart', () => {
  const zoneSets: Array<{ name: string; zones: Zone[] }> = [
    { name: 'default admin zones', zones: DEFAULT_ZONES },
    { name: 'no zones (flat rate fallback)', zones: [] },
    { name: 'single free zone', zones: [zone({ regions: ['IN'], rateType: 'free', flatRate: 0 })] },
    { name: 'zone with a free threshold', zones: [zone({ regions: ['US'], flatRate: 75, freeThreshold: 500 })] },
    { name: 'inactive zone is ignored', zones: [zone({ regions: ['US'], flatRate: 75, active: false })] },
  ]

  for (const { name, zones } of zoneSets) {
    for (const country of COUNTRIES) {
      for (const subtotal of SUBTOTALS) {
        const server = serverCalcShippingCost({
          subtotal,
          country,
          zones,
          baseShippingCost: 25,
          freeShippingThreshold: 100,
        })
        const client = clientCalcShippingCost({
          subtotal,
          country,
          zones,
          baseShippingCost: 25,
          freeShippingThreshold: 100,
        })
        assert.equal(
          client,
          server,
          `shipping mismatch (${name}, ${country}, subtotal ${subtotal}): client ${client} vs server ${server}`,
        )
      }
    }
  }
})

test('client and server resolve the same zone for every country', () => {
  for (const country of COUNTRIES) {
    const serverZone = serverFindZone(DEFAULT_ZONES, country)
    const clientZone = clientFindZone(DEFAULT_ZONES, country)
    assert.equal(
      clientZone?.name ?? null,
      serverZone?.name ?? null,
      `zone mismatch for ${country}`,
    )
  }
})

test('a zone region written as a country label matches on both sides', () => {
  // "Italy" is not in the storefront's 18-country list. If the client could
  // not resolve it, checkout would show the flat rate while the server
  // charged the Europe zone rate.
  const zones = [zone({ name: 'Europe', regions: ['Italy'], flatRate: 200, freeThreshold: 10000 })]
  assert.equal(serverFindZone(zones, 'IT')?.name, 'Europe')
  assert.equal(clientFindZone(zones, 'IT')?.name, 'Europe')
})

test('both sides parse the stored JSON string identically', () => {
  const raw = JSON.stringify(DEFAULT_ZONES)
  assert.deepEqual(clientParseZones(raw), serverParseZones(raw))
  assert.deepEqual(clientParseZones('not json'), serverParseZones('not json'))
  assert.deepEqual(clientParseZones(null), serverParseZones(null))
})
