/**
 * Full-mirror mode planning tests.
 * Run: cd backend && npx tsx --test src/services/ebayMirror.test.ts
 *
 * node:test, matching the project's pure-unit convention
 * (ebayCatalogMapping.test.ts). This module has no prisma/server import, so
 * the whole surface is testable directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contentPatch,
  deepSyncBudget,
  maxImportImages,
  mirrorModeEnabled,
  planImageSync,
  specSignature,
} from './ebayMirror.js'

// ── planImageSync ───────────────────────────────────────────────

test('planImageSync matches on provenance: keeps unchanged, adds new, removes vanished', () => {
  const plan = planImageSync(
    [
      { id: 'row-keep', url: 'https://res.cloudinary.com/keep.webp', sourceUrl: 'https://i.ebayimg.com/a' },
      { id: 'row-gone', url: 'https://res.cloudinary.com/gone.webp', sourceUrl: 'https://i.ebayimg.com/dead' },
    ],
    ['https://i.ebayimg.com/a', 'https://i.ebayimg.com/new'],
  )
  assert.deepEqual(plan, {
    toAdd: ['https://i.ebayimg.com/new'],
    toRemove: ['row-gone'],
  })
})

test('planImageSync falls back to the row url when there is no sourceUrl (legacy rows matching by hand)', () => {
  const plan = planImageSync(
    [{ id: 'legacy', url: 'https://i.ebayimg.com/a' }],
    ['https://i.ebayimg.com/a'],
  )
  assert.deepEqual(plan, { toAdd: [], toRemove: [] })
})

test('planImageSync treats a replaced photo as remove-old + add-new', () => {
  const plan = planImageSync(
    [{ id: 'old', url: 'https://res.cloudinary.com/old.webp', sourceUrl: 'https://i.ebayimg.com/v1' }],
    ['https://i.ebayimg.com/v2'],
  )
  assert.deepEqual(plan, { toAdd: ['https://i.ebayimg.com/v2'], toRemove: ['old'] })
})

test('planImageSync is order-insensitive: a pure reorder adds and removes nothing', () => {
  const plan = planImageSync(
    [
      { id: 'a', url: 'cld://a', sourceUrl: 'https://i.ebayimg.com/a' },
      { id: 'b', url: 'cld://b', sourceUrl: 'https://i.ebayimg.com/b' },
    ],
    ['https://i.ebayimg.com/b', 'https://i.ebayimg.com/a'],
  )
  assert.deepEqual(plan, { toAdd: [], toRemove: [] })
})

test('planImageSync drops every row when the listing lost all photos', () => {
  const plan = planImageSync(
    [{ id: 'keep', url: 'https://res.cloudinary.com/kept.webp', sourceUrl: 'https://i.ebayimg.com/kept' }],
    [],
  )
  assert.deepEqual(plan, { toAdd: [], toRemove: ['keep'] })
})

test('planImageSync dedupes repeated eBay urls', () => {
  const plan = planImageSync([], ['https://x/same', 'https://x/same', 'https://x/other'])
  assert.deepEqual(plan.toAdd, ['https://x/same', 'https://x/other'])
})

// ── specSignature ───────────────────────────────────────────────

test('specSignature is order-sensitive', () => {
  const a = specSignature([{ name: 'MPN', value: 'X' }, { name: 'Brand', value: 'Y' }])
  const b = specSignature([{ name: 'Brand', value: 'Y' }, { name: 'MPN', value: 'X' }])
  assert.notDeepEqual(a.join('\n'), b.join('\n'))
})

test('specSignature equalizes identical lists', () => {
  const a = specSignature([{ name: 'MPN', value: 'X' }, { name: 'Brand', value: 'Y' }])
  const b = specSignature([{ name: 'MPN', value: 'X' }, { name: 'Brand', value: 'Y' }])
  assert.deepEqual(a.join('\n'), b.join('\n'))
})

// ── contentPatch ────────────────────────────────────────────────

const base = {
  name: 'Old Name',
  description: 'old',
  shortDescription: 'old short',
  keyFeatures: ['a'],
  includedItems: ['b'],
  manufacturer: 'OldCo',
  modelNumber: 'X1',
  mpn: 'MPN1',
}

test('contentPatch returns null when the listing agrees with the row', () => {
  assert.equal(contentPatch(base, { ...base }), null)
})

test('contentPatch emits only genuinely changed fields', () => {
  const patch = contentPatch(base, {
    ...base,
    name: 'New Name',
    description: 'new',
    keyFeatures: ['a', 'b'],
    mpn: 'MPN2',
  })
  assert.deepEqual(patch, {
    name: 'New Name',
    description: 'new',
    keyFeatures: ['a', 'b'],
    mpn: 'MPN2',
  })
})

test('contentPatch treats null site values as empty strings', () => {
  const patch = contentPatch({ ...base, description: null, shortDescription: null }, { ...base, description: '', shortDescription: '' })
  assert.equal(patch, null)
})

// ── env-driven knobs ────────────────────────────────────────────

test('mirrorModeEnabled defaults off and reads 1/true/on/yes', () => {
  const original = process.env.EBAY_FULL_MIRROR
  try {
    delete process.env.EBAY_FULL_MIRROR
    assert.equal(mirrorModeEnabled(), false)
    for (const value of ['1', 'true', 'TRUE', 'on', 'yes']) {
      process.env.EBAY_FULL_MIRROR = value
      assert.equal(mirrorModeEnabled(), true)
    }
    process.env.EBAY_FULL_MIRROR = '0'
    assert.equal(mirrorModeEnabled(), false)
  } finally {
    if (original === undefined) delete process.env.EBAY_FULL_MIRROR
    else process.env.EBAY_FULL_MIRROR = original
  }
})

test('deepSyncBudget stays within the daily Trading API reserve', () => {
  const original = process.env.EBAY_MIRROR_GETITEM_BUDGET
  const originalInterval = process.env.EBAY_AUTOSYNC_INTERVAL_MS
  try {
    delete process.env.EBAY_MIRROR_GETITEM_BUDGET
    assert.equal(deepSyncBudget(), 0)
    process.env.EBAY_MIRROR_GETITEM_BUDGET = '900'
    assert.equal(deepSyncBudget(), 0)
    process.env.EBAY_MIRROR_GETITEM_BUDGET = '0'
    assert.equal(deepSyncBudget(), 0)
    process.env.EBAY_AUTOSYNC_INTERVAL_MS = '600000'
    delete process.env.EBAY_MIRROR_GETITEM_BUDGET
    assert.equal(deepSyncBudget(), 0)
  } finally {
    if (original === undefined) delete process.env.EBAY_MIRROR_GETITEM_BUDGET
    else process.env.EBAY_MIRROR_GETITEM_BUDGET = original
    if (originalInterval === undefined) delete process.env.EBAY_AUTOSYNC_INTERVAL_MS
    else process.env.EBAY_AUTOSYNC_INTERVAL_MS = originalInterval
  }
})

test('maxImportImages defaults to eBay allowance and clamps to 1..24', () => {
  const original = process.env.EBAY_IMPORT_MAX_IMAGES
  try {
    delete process.env.EBAY_IMPORT_MAX_IMAGES
    assert.equal(maxImportImages(), 24)
    process.env.EBAY_IMPORT_MAX_IMAGES = '300'
    assert.equal(maxImportImages(), 24)
    process.env.EBAY_IMPORT_MAX_IMAGES = '8'
    assert.equal(maxImportImages(), 8)
  } finally {
    if (original === undefined) delete process.env.EBAY_IMPORT_MAX_IMAGES
    else process.env.EBAY_IMPORT_MAX_IMAGES = original
  }
})
