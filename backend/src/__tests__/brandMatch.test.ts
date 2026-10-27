/**
 * Tests for the manufacturer → brand matching used by the catalogue backfill.
 * Pure logic: no database, real catalogue-shaped fixtures.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBrandPlan,
  deriveBrandName,
  isUsableBrandName,
  normalizeBrandKey,
  type ProductForBrandMatch,
} from '../utils/brandMatch.js'

function product(over: Partial<ProductForBrandMatch>): ProductForBrandMatch {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    manufacturer: over.manufacturer ?? null,
    name: over.name ?? 'Widget',
    sku: over.sku ?? null,
    brandId: over.brandId ?? null,
  }
}

test('normalizeBrandKey folds case, punctuation and Unicode', () => {
  assert.equal(normalizeBrandKey('PROTO'), 'PROTO')
  assert.equal(normalizeBrandKey('Proto'), 'PROTO')
  assert.equal(normalizeBrandKey('Pepperl+Fuchs'), 'PEPPERL FUCHS')
  assert.equal(normalizeBrandKey('Crouse-Hinds'), 'CROUSE HINDS')
  assert.equal(normalizeBrandKey('  tomoe   valve '), 'TOMOE VALVE')
  assert.equal(normalizeBrandKey('Wärtsilä'), 'WARTSILA', 'diacritics fold so the seed brand matches the catalogue')
  assert.equal(normalizeBrandKey(null), '')
})

test('isUsableBrandName rejects placeholders, combined listings and stubs', () => {
  assert.equal(isUsableBrandName('PROTO'), true)
  assert.equal(isUsableBrandName('K-BUS'), true)
  assert.equal(isUsableBrandName('Tomoe Valve'), true)

  assert.equal(isUsableBrandName('Unbranded'), false, 'placeholder')
  assert.equal(isUsableBrandName('UNKNOWN'), false, 'placeholder')
  assert.equal(isUsableBrandName('N/A'), false, 'placeholder')
  assert.equal(isUsableBrandName('TITAN / GEARENCH'), false, 'two brands in one value')
  assert.equal(isUsableBrandName('AE'), false, 'too short to be unambiguous')
  assert.equal(isUsableBrandName(''), false)
  assert.equal(isUsableBrandName('123'), false, 'a pure number is not a brand')
})

test('deriveBrandName keeps the catalogue spelling that occurs most often', () => {
  const variants = new Map<string, number>([
    ['PROTO', 124],
    ['Proto', 6],
  ])
  assert.equal(deriveBrandName(variants), 'PROTO')

  const tie = new Map<string, number>([
    ['WIKA', 2],
    ['Wika', 2],
  ])
  assert.equal(deriveBrandName(tie), 'WIKA', 'ties resolve deterministically (alphabetical)')
})

test('buildBrandPlan links existing brands case-insensitively', () => {
  const plan = buildBrandPlan({
    products: [
      product({ id: 'p1', manufacturer: 'OMRON' }),
      product({ id: 'p2', manufacturer: 'Omron' }),
      product({ id: 'p3', manufacturer: 'ABB' }),
    ],
    existingBrands: [{ id: 'b-omron', name: 'Omron', slug: 'omron' }],
    minProducts: 3,
  })

  assert.equal(plan.links.length, 1, 'Omron matches the existing brand row')
  assert.equal(plan.links[0].brandId, 'b-omron')
  assert.deepEqual(plan.links[0].productIds.sort(), ['p1', 'p2'])

  // ABB is not an existing brand here and is below the threshold → reported.
  assert.equal(plan.creates.length, 0)
  assert.equal(plan.unlinked.length, 1)
  assert.match(plan.unlinked[0].reason, /threshold/)
})

test('buildBrandPlan creates brands above the threshold and reports the rest', () => {
  const plan = buildBrandPlan({
    products: [
      product({ id: 'g1', manufacturer: 'GEDORE' }),
      product({ id: 'g2', manufacturer: 'Gedore' }),
      product({ id: 'g3', manufacturer: 'GEDORE' }),
      product({ id: 'r1', manufacturer: 'RIDGID' }),
      product({ id: 'r2', manufacturer: 'RIDGID' }),
      product({ id: 'x1', manufacturer: 'Rare Brand' }),
      product({ id: 'u1', manufacturer: 'Unbranded' }),
      product({ id: 't1', manufacturer: 'TITAN / GEARENCH' }),
      product({ id: 'n1', manufacturer: null }),
      product({ id: 'a1', manufacturer: 'ABB', brandId: 'already-set' }),
    ],
    existingBrands: [],
    minProducts: 3,
  })

  assert.equal(plan.totalProducts, 10)
  assert.equal(plan.alreadyLinked, 1, 'the pre-linked product is left alone')
  assert.equal(plan.noManufacturer, 1)

  assert.equal(plan.creates.length, 1)
  const gedore = plan.creates[0]
  assert.equal(gedore.name, 'GEDORE', 'most common spelling wins')
  assert.equal(gedore.slug, 'gedore')
  assert.deepEqual(gedore.productIds.sort(), ['g1', 'g2', 'g3'])

  const reasons = new Map(plan.unlinked.map((u) => [u.manufacturer, u.reason]))
  assert.match(String(reasons.get('RIDGID')), /threshold/)
  assert.match(String(reasons.get('Rare Brand')), /threshold/)
  assert.match(String(reasons.get('Unbranded')), /not a usable brand name/)
  assert.match(String(reasons.get('TITAN / GEARENCH')), /not a usable brand name/)

  assert.equal(plan.linkableProducts, 3)
})

test('buildBrandPlan avoids slug collisions with existing brands and old URLs', () => {
  const plan = buildBrandPlan({
    products: [
      product({ id: 'a', manufacturer: 'GEDORE' }),
      product({ id: 'b', manufacturer: 'GEDORE' }),
      product({ id: 'c', manufacturer: 'GEDORE' }),
    ],
    existingBrands: [{ id: 'x', name: 'Something Else', slug: 'gedore' }],
    reservedSlugs: ['gedore-2'],
    minProducts: 3,
  })

  assert.equal(plan.creates.length, 1)
  assert.equal(plan.creates[0].slug, 'gedore-3', 'skips the taken slug and the historical one')
})

test('buildBrandPlan honours explicit exclusions', () => {
  const plan = buildBrandPlan({
    products: [
      product({ id: 'a', manufacturer: 'STANLEY' }),
      product({ id: 'b', manufacturer: 'STANLEY' }),
      product({ id: 'c', manufacturer: 'STANLEY' }),
    ],
    existingBrands: [],
    minProducts: 3,
    extraExcludes: ['stanley'],
  })

  assert.equal(plan.creates.length, 0)
  assert.match(plan.unlinked[0].reason, /excluded on the command line/)
})
