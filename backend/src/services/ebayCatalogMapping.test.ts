/**
 * Pure mapping tests for the eBay catalog importer.
 * Run: cd backend && npx tsx --test src/services/ebayCatalogMapping.test.ts
 *
 * node:test, matching the project's existing unit-test convention. These tests
 * intentionally import only the pure mapping module — importing the import
 * service would boot the HTTP server through server.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDescription,
  buildSeoDescription,
  buildSeoTitle,
  buildShortDescription,
  cleanTitle,
  decodeHtmlEntities,
  extractIdentity,
  htmlToPlainText,
  mapEbayCondition,
  planConditionUpdate,
  matchBrandId,
  resolveCategoryId,
  normalizeCurrency,
  normalizeEbaySku,
  validGtin,
} from './ebayCatalogMapping.js'
import type { EbayItemDetails } from './ebayTradingService.js'

// ── HTML → plain text ─────────────────────────────────────────

test('htmlToPlainText strips scripts, styles and tags', () => {
  const html = '<style>.x{color:red}</style><script>alert(1)</script><p>Hydraulic <b>pump</b></p>'
  assert.equal(htmlToPlainText(html), 'Hydraulic pump')
})

test('htmlToPlainText keeps paragraph and list boundaries', () => {
  const html = '<p>First line</p><ul><li>One</li><li>Two</li></ul><div>Last line</div>'
  const text = htmlToPlainText(html)
  assert.match(text, /First line/)
  assert.match(text, /• One/)
  assert.match(text, /Last line/)
})

test('htmlToPlainText decodes named and numeric entities', () => {
  assert.equal(htmlToPlainText('<p>Oil &amp; filter &nbsp; 10&#176;C &#x2192; ready</p>'), 'Oil & filter 10°C → ready')
})

test('decodeHtmlEntities leaves unknown entities intact', () => {
  assert.equal(decodeHtmlEntities('A &unknown; B'), 'A &unknown; B')
})

test('htmlToPlainText returns an empty string for missing input', () => {
  assert.equal(htmlToPlainText(null), '')
  assert.equal(htmlToPlainText(undefined), '')
})

// ── Titles / SKU / currency ───────────────────────────────────

test('cleanTitle collapses whitespace and decodes entities', () => {
  assert.equal(cleanTitle('  Caterpillar   3512B &amp; 3516  '), 'Caterpillar 3512B & 3516')
})

test('cleanTitle truncates to the column limit', () => {
  assert.equal(cleanTitle('x'.repeat(600)).length, 500)
})

test('normalizeEbaySku preserves a seller SKU (spaces included)', () => {
  assert.equal(normalizeEbaySku('Z 40', '123'), 'Z 40')
})

test('normalizeEbaySku falls back to the item id when SKU is blank', () => {
  assert.equal(normalizeEbaySku('   ', '123456789012'), 'EBAY-123456789012')
})

test('normalizeEbaySku truncates to 100 characters', () => {
  assert.equal(normalizeEbaySku('s'.repeat(120), '1').length, 100)
})

test('normalizeCurrency accepts ISO codes and defaults invalid values', () => {
  assert.equal(normalizeCurrency('usd'), 'USD')
  assert.equal(normalizeCurrency('GBP'), 'GBP')
  assert.equal(normalizeCurrency('US'), 'USD')
  assert.equal(normalizeCurrency(null), 'USD')
})

// ── Condition ─────────────────────────────────────────────────

test('mapEbayCondition maps new/refurbished/used variants', () => {
  assert.equal(mapEbayCondition('New'), 'new')
  assert.equal(mapEbayCondition('Brand New'), 'new')
  assert.equal(mapEbayCondition('New other (see details)'), 'unused')
  assert.equal(mapEbayCondition('Like New'), 'unused')
  assert.equal(mapEbayCondition('Open box'), 'unused')
  assert.equal(mapEbayCondition('Refurbished'), 'refurbished')
  assert.equal(mapEbayCondition('Seller refurbished'), 'refurbished')
  assert.equal(mapEbayCondition('Used'), 'used')
  assert.equal(mapEbayCondition('Used - Very Good'), 'used')
  assert.equal(mapEbayCondition('Good'), 'used')
  assert.equal(mapEbayCondition('Acceptable - Used'), 'used')
  assert.equal(mapEbayCondition('For parts or not working'), 'used')
  assert.equal(mapEbayCondition(null), 'used')
})

test('mapEbayCondition reads eBay numeric ConditionIds (display name absent)', () => {
  assert.equal(mapEbayCondition('1000'), 'new')
  assert.equal(mapEbayCondition('1500'), 'unused')
  assert.equal(mapEbayCondition('1750'), 'unused')
  assert.equal(mapEbayCondition('2000'), 'refurbished')
  assert.equal(mapEbayCondition('2500'), 'refurbished')
  assert.equal(mapEbayCondition('3000'), 'refurbished')
  assert.equal(mapEbayCondition('4000'), 'used')
  assert.equal(mapEbayCondition('5000'), 'used')
  assert.equal(mapEbayCondition('6000'), 'used')
  assert.equal(mapEbayCondition('7000'), 'used')
})

// ── Condition mirror plan (sweep / backfill shared rule) ──────

test('planConditionUpdate imports eBay condition when the row disagrees', () => {
  const plan = planConditionUpdate({ condition: 'unused', conditionNotes: null }, 'Used - Very Good')
  assert.deepEqual(plan, { condition: 'used', conditionNotes: 'Used - Very Good' })
})

test('planConditionUpdate refreshes stale notes that word a different class', () => {
  // Old default rows: condition column may already say "used" while the note
  // still claims the old boxed/never-used wording.
  const plan = planConditionUpdate({ condition: 'used', conditionNotes: 'New other (see details)' }, 'Used - Good')
  assert.deepEqual(plan, { condition: 'used', conditionNotes: 'Used - Good' })
})

test('planConditionUpdate records eBay wording when the row has no note yet', () => {
  const plan = planConditionUpdate({ condition: 'used', conditionNotes: null }, 'Used - Very Good')
  assert.deepEqual(plan, { condition: 'used', conditionNotes: 'Used - Very Good' })
})

test('planConditionUpdate returns null once the row mirrors eBay', () => {
  const row = { condition: 'used', conditionNotes: 'Used - Very Good' }
  assert.equal(planConditionUpdate(row, 'Used - Very good'), null)
  assert.equal(planConditionUpdate(row, null), null)
  assert.equal(planConditionUpdate(row, undefined), null)
})

test('planConditionUpdate tracks eBay condition edits in both directions', () => {
  const plan = planConditionUpdate({ condition: 'used', conditionNotes: 'Used - Very Good' }, 'Seller refurbished')
  assert.deepEqual(plan, { condition: 'refurbished', conditionNotes: 'Seller refurbished' })
})

// ── Identity ──────────────────────────────────────────────────

test('validGtin accepts 8 or 12-14 digit identifiers only', () => {
  assert.equal(validGtin('12345678'), '12345678')
  assert.equal(validGtin('123456789012'), '123456789012')
  assert.equal(validGtin('1234567890123'), '1234567890123')
  assert.equal(validGtin('12345678901234'), '12345678901234')
  assert.equal(validGtin('12345678901'), null)
  assert.equal(validGtin('12-34'), null)
})

test('extractIdentity reads the common eBay item-specific spellings', () => {
  const identity = extractIdentity([
    { name: 'Brand', value: 'Caterpillar' },
    { name: 'Manufacturer Part Number', value: '7W-1234' },
    { name: 'Model', value: '3512B' },
    { name: 'IMPA Code', value: 'IMPA 123456' },
    { name: 'UPC', value: '012345678905' },
  ])
  assert.deepEqual(identity, {
    manufacturer: 'Caterpillar',
    mpn: '7W-1234',
    modelNumber: '3512B',
    gtin: '012345678905',
    impaCode: 'IMPA 123456',
  })
})

test('extractIdentity is null-safe and ignores empty values', () => {
  const identity = extractIdentity([{ name: 'Brand', value: '   ' }])
  assert.equal(identity.manufacturer, null)
  assert.equal(identity.mpn, null)
  assert.equal(identity.gtin, null)
})

test('extractIdentity caps values to catalog column limits', () => {
  const identity = extractIdentity([
    { name: 'Brand', value: 'b'.repeat(300) },
    { name: 'MPN', value: 'm'.repeat(200) },
    { name: 'Model', value: 'x'.repeat(200) },
    { name: 'IMPA', value: 'i'.repeat(100) },
  ])
  assert.equal(identity.manufacturer?.length, 255)
  assert.equal(identity.mpn?.length, 100)
  assert.equal(identity.modelNumber?.length, 100)
  assert.equal(identity.impaCode?.length, 50)
})

// ── SEO / description ─────────────────────────────────────────

test('buildSeoTitle caps at 70 characters', () => {
  assert.equal(buildSeoTitle('x'.repeat(120))?.length, 70)
})

test('buildSeoDescription stays within the 80-160 publish window', () => {
  const seo = buildSeoDescription({
    title: 'Caterpillar 3512B Marine Engine',
    condition: 'Used',
    manufacturer: 'Caterpillar',
    description: 'Complete used engine removed from a working vessel. Inspected and tested by our workshop before listing.',
  })
  assert.ok(seo)
  assert.ok(seo.length >= 80 && seo.length <= 160, `unexpected length ${seo.length}`)
})

test('buildSeoDescription returns null when there is not enough material', () => {
  assert.equal(buildSeoDescription({ title: 'Pump' }), null)
})

test('buildShortDescription uses the first sentence and caps at 300 chars', () => {
  const short = buildShortDescription('A complete engine assembly. It was tested before removal.', 'Fallback title')
  assert.equal(short, 'A complete engine assembly.')
  assert.equal(buildShortDescription(null, 'Fallback title'), 'Fallback title')
})

test('buildDescription keeps the eBay condition line and plain description', () => {
  const details = {
    condition: 'Used',
    specifics: [{ name: 'Brand', value: 'Caterpillar' }],
  } as EbayItemDetails
  assert.equal(buildDescription('Runs well.', details), 'Condition: Used\n\nRuns well.')
})

test('buildDescription falls back to item specifics when the description is empty', () => {
  const details = {
    condition: null,
    specifics: [{ name: 'Brand', value: 'Caterpillar' }],
  } as EbayItemDetails
  assert.equal(buildDescription('', details), 'Brand: Caterpillar')
})

// ── Category / brand matching ────────────────────────────────

test('resolveCategoryId binds the resolved slug to a live category id', () => {
  const categories = [
    { id: 'cat-1', slug: 'engine-parts', name: 'Engine Parts' },
    { id: 'cat-2', slug: 'other-business', name: 'Other Business & Industrial' },
  ]
  const matched = resolveCategoryId({ categoryName: 'Engine Components', title: 'Caterpillar C32 Cylinder Liner' }, categories)
  assert.equal(matched.categoryId, 'cat-1')
  assert.equal(matched.assignment.slug, 'engine-parts')
})

test('resolveCategoryId falls back to the other-business row when nothing matches', () => {
  const categories = [
    { id: 'cat-1', slug: 'engine-parts', name: 'Engine Parts' },
    { id: 'cat-2', slug: 'other-business', name: 'Other Business & Industrial' },
  ]
  const matched = resolveCategoryId({ title: 'zzq unmappable listing 001' }, categories)
  assert.equal(matched.assignment.confidence, 'fallback')
  assert.equal(matched.categoryId, 'cat-2')
})

test('resolveCategoryId returns null ids when the fallback row is missing', () => {
  const matched = resolveCategoryId({ title: 'zzq unmappable listing 002' }, [])
  assert.equal(matched.assignment.slug, 'other-business')
  assert.equal(matched.categoryId, null)
})

test('matchBrandId is exact after normalization', () => {
  const brands = [
    { id: 'brand-1', name: 'Caterpillar' },
    { id: 'brand-2', name: 'Cummins' },
  ]
  assert.equal(matchBrandId('caterpillar', brands), 'brand-1')
  assert.equal(matchBrandId('CAT', brands), null)
  assert.equal(matchBrandId(null, brands), null)
})
