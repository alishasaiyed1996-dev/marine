/**
 * Pure-helper tests for the GraphQL listing previews feature. Only the
 * deterministic logic is exercised here (no network, no prisma) — matching
 * the ebayOrderEvents.ts test convention: import from the PURE module. The
 * gateway/persistence orchestration is covered by a sandbox run (see
 * docs/ebay-listing-previews.md).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExternalProductDetails,
  usableExternalImageUrls,
  externalCategoryName,
  truncateTitle,
  mergeAspectRecommendations,
  recommendedCategoryId,
  completionStatusToTaskStatus,
  EXTERNAL_PRODUCT_TITLE_CAP,
  MAX_EXTERNAL_PRODUCTS,
  type PreviewAspects,
} from './ebayListingPreviewsPure.js'

// ─── buildExternalProductDetails ───────────────────────────────

test('external product carries sku, 250-char title, Brand/MPN aspects and breadcrumb category', () => {
  const details = buildExternalProductDetails(
    {
      id: 'p1', sku: 'F 32', name: 'Rexroth Hydraulic Pump A10VSO ' + 'x'.repeat(240),
      manufacturer: 'Bosch Rexroth', mpn: 'R902400313',
      category: {
        name: 'Hydraulic Pumps',
        parent: { name: 'Industrial Equipment', parent: { name: 'Manufacturing' } },
      },
    },
    ['https://img.example/1.jpg'],
  )
  assert.equal(details.sku, 'F 32')
  assert.equal(details.title.length, EXTERNAL_PRODUCT_TITLE_CAP)
  assert.deepEqual(details.aspects, [
    { name: 'Brand', values: ['Bosch Rexroth'] },
    { name: 'MPN', values: ['R902400313'] },
  ])
  // GTIN-only identifiers (UPC|ISBN|EAN) — MPN is documented as unsupported
  // and a GTIN would exclude every other field, so no identifier is sent.
  assert.equal('externalProductIdentifier' in details, false)
  assert.equal(details.categoryName, '/Manufacturing/Industrial Equipment/Hydraulic Pumps')
})

test('external product without manufacturer/mpn omits aspects, keeps the plain category name', () => {
  const details = buildExternalProductDetails(
    { id: 'p2', sku: 'NOBRAND', name: 'Mystery marine part', category: { name: 'Hydraulic Pumps' } },
    [],
  )
  assert.deepEqual(details.aspects, [])
  assert.equal('externalProductIdentifier' in details, false)
  // No ancestry → leaf name without a leading slash (both forms documented).
  assert.equal(details.categoryName, 'Hydraulic Pumps')
})

test('externalCategoryName builds root→leaf paths and degrades to the leaf name', () => {
  assert.equal(externalCategoryName({ name: 'Leaf' }), 'Leaf')
  assert.equal(
    externalCategoryName({ name: 'Leaf', parent: { name: 'Mid', parent: { name: 'Root' } } }),
    '/Root/Mid/Leaf',
  )
  assert.equal(externalCategoryName(null), undefined)
  assert.equal(externalCategoryName({ name: '   ' }), undefined)
})

test('aspect values clamp to the documented 100-char cap', () => {
  const details = buildExternalProductDetails(
    { id: 'p3', sku: 'LONG', name: 'Long brand test', manufacturer: 'B'.repeat(140) },
    [],
  )
  assert.deepEqual(details.aspects, [{ name: 'Brand', values: ['B'.repeat(100)] }])
})

test('plain-http and javascript URLs are dropped and duplicates removed (deterministic order)', () => {
  const urls = usableExternalImageUrls([
    'http://img.example/insecure.jpg', 'javascript:alert(1)', 'https://img.example/1.jpg',
    'https://img.example/1.jpg', 'https://img.example/2.jpg', null, ' ',
  ])
  assert.deepEqual(urls, ['https://img.example/1.jpg', 'https://img.example/2.jpg'])
})

// ─── mergeAspectRecommendations: the PREFILL/HINT policy ───────

function previewAspect(name: string, values: string[], confidence?: string): PreviewAspects[number] {
  return confidence
    ? { name, values: values.map((value) => ({ value, confidence })), aspectValues: values }
    : { name, aspectValues: values }
}

test('PREFILL aspects enrich the base map; seller keys are never stolen', () => {
  const { aspects, added } = mergeAspectRecommendations(
    { Brand: ['Bosch Rexroth'], MPN: ['R902400313'] },
    [
      previewAspect('Brand', ['Someone Else'], 'PREFILL'),
      previewAspect('MPN', ['Other'], 'PREFILL'),
      previewAspect('Model', ['A10VSO 71'], 'HINT'),
      previewAspect('Type', ['Hydraulic Pump'], 'PREFILL'),
      previewAspect('Condition', ['Used'], 'HINT'),
    ],
  )
  assert.equal(aspects.Brand[0], 'Bosch Rexroth')
  assert.equal(aspects.MPN[0], 'R902400313')
  assert.equal(aspects.Type[0], 'Hydraulic Pump')
  assert.ok(!aspects.Model, 'HINT-only aspect must not be auto-applied')
  assert.deepEqual(added.sort(), ['Type'])
})

test('aspects without the values edge fall back to aspectValues', () => {
  const { aspects } = mergeAspectRecommendations({}, [
    { name: 'Fuel Type', aspectValues: ['Diesel'] },
  ])
  assert.deepEqual(aspects['Fuel Type'], ['Diesel'])
})

test('values edge with HINT does NOT fall back to aspectValues', () => {
  const { aspects } = mergeAspectRecommendations({}, [
    { name: 'Color', values: [{ value: 'Red', confidence: 'HINT' }], aspectValues: ['Red'] },
  ])
  assert.ok(!aspects.Color)
})

test('empty/unknown aspect entries are skipped', () => {
  const { aspects, added } = mergeAspectRecommendations({}, [
    { name: ' ', values: [{ value: 'x', confidence: 'PREFILL' }] },
    { name: 'Brand' },
    previewAspect('Model', ['', '   '], 'PREFILL'),
    undefined,
  ] as unknown as PreviewAspects)
  assert.deepEqual(aspects, {})
  assert.deepEqual(added, [])
})

// ─── recommendedCategoryId ─────────────────────────────────────

test('preview row categoryId wins, response category is the fallback', () => {
  assert.equal(recommendedCategoryId({ categoryId: '169214', response: { category: { id: 'internal-uuid' } } }), '169214')
  assert.equal(recommendedCategoryId({ categoryId: null, response: { category: { categoryId: '169214' } } }), '169214')
  assert.equal(recommendedCategoryId({ categoryId: null, response: { category: { id: '169214' } } }), '169214')
  assert.equal(recommendedCategoryId({ categoryId: null, response: undefined }), null)
  assert.equal(recommendedCategoryId(null), null)
})

// ─── completionStatusToTaskStatus ──────────────────────────────

test('completion status normalizes to local task states', () => {
  assert.equal(completionStatusToTaskStatus('COMPLETED'), 'completed')
  assert.equal(completionStatusToTaskStatus('completed_with_error'), 'completed_with_error')
  assert.equal(completionStatusToTaskStatus('FAILED'), 'failed')
  assert.equal(completionStatusToTaskStatus(null), 'running')
  assert.equal(completionStatusToTaskStatus('IN_PROGRESS'), 'running')
})

// ─── configuration sanity ──────────────────────────────────────

test('batch cap stays within the mapped-API bounds (eBay maximum: 10 products)', () => {
  assert.ok(MAX_EXTERNAL_PRODUCTS >= 1 && MAX_EXTERNAL_PRODUCTS <= 10)
  assert.equal(truncateTitle('   '), '')
})
