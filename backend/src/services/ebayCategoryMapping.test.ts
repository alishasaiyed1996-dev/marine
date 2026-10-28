/**
 * Pure category-mapping rule tests.
 * Run: cd backend && npx tsx --test src/services/ebayCategoryMapping.test.ts
 *
 * These mirror real-world shapes of the store's eBay data (store mirror
 * category names, eBay taxonomy leaf names, titled surplus listings) so a
 * regression in the assignment rules fails the suite before import time.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_CATEGORY_SLUG,
  categoryIdForSlug,
  isWebsiteCategorySlug,
  normalizeCategoryText,
  resolveWebsiteCategory,
} from './ebayCategoryMapping.js'

test('normalizeCategoryText lowercases and tokenizes punctuation', () => {
  assert.equal(normalizeCategoryText('Electrical & Automation'), 'electrical and automation')
  assert.equal(normalizeCategoryText('MAN B&W — 6S60MC'), 'man b and w 6s60mc')
  assert.equal(normalizeCategoryText('  Hydraulic   Pumps! '), 'hydraulic pumps')
})

test('isWebsiteCategorySlug accepts the seeded slugs and rejects junk', () => {
  assert.equal(isWebsiteCategorySlug('engine-spare'), true)
  assert.equal(isWebsiteCategorySlug('other-business'), true)
  assert.equal(isWebsiteCategorySlug('other'), false)
  assert.equal(isWebsiteCategorySlug(null), false)
})

// ── eBay store-mirror category names ───────────────────────────

test('store-mirror category name maps by alias', () => {
  assert.equal(resolveWebsiteCategory({ categoryName: 'Electrical and automation' }).slug, 'electrical')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Marine pumps' }).slug, 'marine-pumps')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Hydraulic pumps and motors' }).slug, 'hydraulic-pumps')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Equipments and tools' }).slug, 'tools-equipment')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Other businesss and industrial' }).slug, 'other-business')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Ship navigation' }).slug, 'ship-navigation')
})

test('hydraulic pumps beats the generic hydraulics alias', () => {
  const assignment = resolveWebsiteCategory({ categoryName: 'Hydraulic Pumps and Motors' })
  assert.equal(assignment.slug, 'hydraulic-pumps')
})

// ── eBay taxonomy leaf names ───────────────────────────────────

test('eBay taxonomy names map through keyword aliases', () => {
  assert.equal(resolveWebsiteCategory({ categoryName: 'Industrial Electrical Equipment' }).slug, 'electrical')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Engine Components' }).slug, 'engine-parts')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Safety and Survival Equipment' }).slug, 'safety')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Marine Pumps and Fittings' }).slug, 'marine-pumps')
})

// ── Title keywords with specificity ordering ──────────────────

test('most specific rules win over generic ones', () => {
  assert.equal(resolveWebsiteCategory({ title: 'Rexroth A10VSO Hydraulic Pump Series' }).slug, 'hydraulic-pumps')
  assert.equal(resolveWebsiteCategory({ title: 'Allweiler SN Screw Pump Marine' }).slug, 'marine-pumps')
  assert.equal(resolveWebsiteCategory({ title: 'Alfa Laval Sunny Centrifuge Purifier Oil Separator' }).slug, 'ship-machinery')
  assert.equal(resolveWebsiteCategory({ title: 'Furuno Navnet Radar Display Unit' }).slug, 'ship-navigation')
  assert.equal(resolveWebsiteCategory({ title: 'SMC Solenoid Valve SY7120 24V' }).slug, 'pneumatic')
  assert.equal(resolveWebsiteCategory({ title: 'Crosby Bow Shackle 3/4" G209' }).slug, 'rigging')
  assert.equal(resolveWebsiteCategory({ title: 'Yale Chain Block 2 Ton x 3m' }).slug, 'lifting-handling')
  assert.equal(resolveWebsiteCategory({ title: 'Stahlwille Combination Spanner Set 12pc' }).slug, 'hand-tools')
  assert.equal(resolveWebsiteCategory({ title: 'Siemens 3RW44 Soft Starter' }).slug, 'electrical')
  assert.equal(resolveWebsiteCategory({ title: 'Caterpillar C32 Cylinder Liner Genuine' }).slug, 'engine-parts')
  assert.equal(resolveWebsiteCategory({ title: 'Duragreed Fireman Outfit Breathing Apparatus' }).slug, 'safety')
})

test('ambiguity resolves by rule order between related slugs', () => {
  // "hydraulic" + "pump" → hydraulic-pumps, not hydraulic; brand-only "vickers" alone → hydraulic.
  assert.equal(resolveWebsiteCategory({ title: 'Vickers DG4V Directional Valve' }).slug, 'hydraulic')
  assert.equal(resolveWebsiteCategory({ title: 'Vickers V10 Hydraulic Pump' }).slug, 'hydraulic-pumps')
})

test('eBay category name wins over title keywords (priority phase order)', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Ship Navigation',
    title: 'Siemens Contactor 3RT0245 Contactor Relay',
  })
  assert.equal(assignment.slug, 'ship-navigation')
  assert.equal(assignment.confidence, 'ebay-category')
})

test('item specifics are the last keyword source', () => {
  const assignment = resolveWebsiteCategory({
    title: 'Genuine Wear Component 0917 003B',
    specifics: [
      { name: 'Brand', value: 'Rexroth' },
      { name: 'Model', value: 'A2FM Hydraulic Motor 80cc' },
    ],
  })
  assert.equal(assignment.slug, 'hydraulic-pumps')
  assert.equal(assignment.confidence, 'keyword')
  assert.match(assignment.reason, /item specifics/)
})

// ── Fallback behavior ──────────────────────────────────────────

test('unresolvable listings fall back to other-business, never null', () => {
  const assignment = resolveWebsiteCategory({ title: '09-1 P7003 Sharp Corner 2' })
  assert.equal(assignment.slug, FALLBACK_CATEGORY_SLUG)
  assert.equal(assignment.confidence, 'fallback')
})

test('empty input falls back too', () => {
  const assignment = resolveWebsiteCategory({})
  assert.equal(assignment.slug, FALLBACK_CATEGORY_SLUG)
  assert.equal(assignment.confidence, 'fallback')
})

// ── Env pin map (EBAY_CATEGORY_ID_MAP) ────────────────────────

test('category name outranks keyword when the name has an alias but the title disagrees', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Marine Pumps',
    title: 'AG Kelly Hand Plier 010',
  })
  assert.equal(assignment.slug, 'marine-pumps')
})

// ── Breadcrumb leaf-first scanning (eBay colon-separated names) ─

test('leaf segment beats generic breadcrumb parents', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:Light Equipment & Tools:Hand Tools:Wrenches',
  })
  assert.equal(assignment.slug, 'hand-tools')
  assert.equal(assignment.confidence, 'ebay-category')
  assert.match(assignment.reason, /Wrenches/)
})

test('leaf keyword alias decides inside the most specific segment', () => {
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Pipe Tools:Pipe Wrenches' }).slug,
    'hand-tools',
  )
})

test('pipe-tong jaw listings land in hand-tools, not tools-equipment', () => {
  // Wild-caught regression: GEARENCH/TITAN chain-tong jaw titles live under
  // eBay's generic "Light Equipment & Tools" branch; the leaf must decide.
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:Light Equipment & Tools:Pipe Tools:Pipe Wrenches',
    title: 'GEARENCH TITAN C141 Replacement Jaws for Chain Tong Pipe Wrench Tool',
  })
  assert.equal(assignment.slug, 'hand-tools')
})

test('"Other <X>" leaves carry no signal: the parent decides', () => {
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Hand Tools:Other Hand Tools' }).slug,
    'hand-tools',
  )
})

test('"Other <X>" leaf over an unmatched parent falls through to content keywords', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:CNC, Metalworking & Manufacturing:Workholding & Toolholding:Toolholding:Other Toolholding',
    title: 'CHRIS MARINE 11373-20-10 Cylinder Honing Stone Set of 8',
  })
  assert.equal(assignment.slug, 'engine-parts')
  assert.equal(assignment.confidence, 'keyword')
})

test('"Other <X>" everywhere ends in the fallback', () => {
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Other Business & Industrial' }).slug,
    FALLBACK_CATEGORY_SLUG,
  )
})

test('hoists and winches branches map to lifting-handling', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:Material Handling:Hoists, Winches & Rigging:Cranes & Hoists:Other Cranes & Hoists',
    title: 'Heavy Duty Snubby Hoist Line Load Limiter 3000 LBS USA Made',
  })
  assert.equal(assignment.slug, 'lifting-handling')
})

test('<X> Tools leaves do not blanket-map to tools-equipment', () => {
  // RIDGID-style pipe working tooling lives in hand-tools, matching the
  // site's own rules (threading tools, reamers, die sets are hand tools).
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Pipe Tools' }).slug,
    'hand-tools',
  )
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Pipe Tools:Flaring Tools' }).slug,
    'hand-tools',
  )
  assert.equal(
    resolveWebsiteCategory({ title: 'RIDGID No 358 Geared Ratchet Tube Bender 5/8 16MM OD' }).slug,
    'hand-tools',
  )
})

test('alarm and access-control branches stay out of tools-equipment', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:Facility Maintenance & Safety:Surveillance & Alarm Equipment',
    title: 'DNH HP-15 T Weatherproof Horn Speaker 15W 100V Line',
  })
  assert.equal(assignment.slug, 'electrical')
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Facility Maintenance & Safety:Access Control Equipment' }).slug,
    'electrical',
  )
})

test('Air Tools leaves resolve to pneumatic', () => {
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Air Tools' }).slug,
    'pneumatic',
  )
})

test('genuinely generic power-tool leaves still reach tools-equipment', () => {
  assert.equal(
    resolveWebsiteCategory({ categoryName: 'Business & Industrial:Light Equipment & Tools:Power Tools' }).slug,
    'tools-equipment',
  )
})

test('Electrical Tools branch defers to hand-tool titles, not otherwise', () => {
  const assignment = resolveWebsiteCategory({
    categoryName: 'Business & Industrial:Light Equipment & Tools:Electrical Tools',
    title: 'CRAB DK-60 Manual Crimping Tool Heavy Duty Industrial Hand Tool',
  })
  assert.equal(assignment.slug, 'hand-tools')
  assert.equal(assignment.confidence, 'ebay-category')

  // Without a hand-tool title the branch stands.
  assert.equal(
    resolveWebsiteCategory({
      categoryName: 'Business & Industrial:Light Equipment & Tools:Electrical Tools',
      title: 'FLUKE 87V Multimeter',
    }).slug,
    'electrical',
  )
})

// ── Plural-tolerant phrase matching ────────────────────────────

test('matching is plural-tolerant on the final word', () => {
  assert.equal(resolveWebsiteCategory({ categoryName: 'Water Pumps' }).slug, 'marine-pumps')
  assert.equal(resolveWebsiteCategory({ categoryName: 'Hand Tools' }).slug, 'hand-tools')
  assert.equal(resolveWebsiteCategory({ title: 'Set of Pipe Wrenches 14 inch' }).slug, 'hand-tools')
})

// ── categoryIdForSlug ─────────────────────────────────────────

const categories = [
  { id: 'id-electrical', slug: 'electrical', name: 'Electrical & Automation' },
  { id: 'id-engine-parts', slug: 'engine-parts', name: 'Engine Parts' },
  { id: 'id-other', slug: 'other-business', name: 'Other Business & Industrial' },
]

test('categoryIdForSlug resolves the slug to a live category id', () => {
  assert.equal(categoryIdForSlug('engine-parts', categories), 'id-engine-parts')
})

test('categoryIdForSlug falls back to other-business and then null', () => {
  assert.equal(categoryIdForSlug('deleted-cat', categories), 'id-other')
  assert.equal(categoryIdForSlug('deleted-cat', []), null)
})
