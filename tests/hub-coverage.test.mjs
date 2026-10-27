/**
 * Hub coverage copy regression tests.
 *
 * Brand/category hub pages gain one catalogue-derived sentence ("Common part
 * families covered: …") built by shared/product-page.mjs so the
 * server-rendered body, the React pages and the module doc agree. These tests
 * pin: (1) the fact rule — every phrase in the sentence must be repeated
 * across ≥3 real product names, no invented categories; (2) the parity rule —
 * every render surface uses the SAME builder, never a locally re-implemented
 * copy; (3) the normalizer rule — the production data script uses the backend
 * twin of the same cleaner, and never the shared module the api image cannot
 * resolve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MARKETPLACE_NOISE_RE,
  cleanProductName,
  hubProductFacts,
  hubCoverageSentence,
} from '../shared/product-page.mjs'

const CATALOGUE_SAMPLE = [
  { id: '1', name: 'PROTO Bearing Puller 3 Jaw 5 Ton' },
  { id: '2', name: 'Bearing Puller 2 Jaw 100mm PROTO' },
  { id: '3', name: 'PROTO Bearing Puller Kit 15 Ton' },
  { id: '4', name: 'Torque Wrench PROTO 1/2in Dr 40-200Nm' },
  { id: '5', name: 'PROTO Torque Wrench 3/4in 110-540Nm' },
  { id: '6', name: 'Torque Wrench Set 12pc 1/2in' },
  { id: '7', name: 'Pipe Cutter 12-64mm Ridgid' },
  { id: '8', name: 'Ridgid Pipe Cutter Replacement Wheel' },
  { id: '9', name: 'PROTO Pipe Wrench 24in Heavy Duty' },
  { id: '10', name: 'PROTO Heavy Duty Pipe Wrench 18in' },
  { id: '11', name: 'Heavy Duty Pipe Wrench 36in PROTO' },
]

test('cleanProductName strips catalog-imported marketplace noise', () => {
  assert.equal(cleanProductName('Chris Marine 11373 20/10 Piston Crown - New Fast Ship FedEx'), 'Chris Marine 11373 20/10 Piston Crown')
  assert.equal(cleanProductName('Bearing Puller 3 Jaw — FastShip Worldwide Shipping'), 'Bearing Puller 3 Jaw')
})

test('MARKETPLACE_NOISE_RE is exported as the shared definition', () => {
  assert.match(MARKETPLACE_NOISE_RE.source, /fast\\s\*ship/)
  // Fresh instance: the exported literal keeps `g` state between .test calls.
  const noise = new RegExp(MARKETPLACE_NOISE_RE.source, MARKETPLACE_NOISE_RE.flags)
  assert.ok(noise.test('Bearing Puller New Fast Ship FedEx'), 'matches the real junk token shape')
  assert.ok(!noise.test('Bearing Puller New'), 'no false positives on part identity words')
})

test('hubProductFacts only reports phrases repeated across three or more products', () => {
  const facts = hubProductFacts(CATALOGUE_SAMPLE, { exclude: ['PROTO'] })
  assert.ok(facts.families.includes('bearing puller'), 'two-word family phrase')
  assert.ok(facts.families.includes('torque wrench'))
  assert.ok(facts.families.includes('pipe wrench'))
  assert.ok(!facts.families.includes('pipe cutter'), 'only two products carry it')
  assert.ok(!facts.families.includes('proto'), 'the hub entity name is excluded')
  assert.equal(facts.productsScanned, CATALOGUE_SAMPLE.length)
})

test('hubProductFacts suppresses sub-phrases once a longer family is kept', () => {
  const facts = hubProductFacts(CATALOGUE_SAMPLE, { exclude: ['PROTO'] })
  // "torque wrench" is kept, so the lone word of that phrase must not also
  // appear as its own family, and neither may a mid-chain artifact like
  // "duty pipe" (inside "heavy duty pipe wrench").
  const torqueIndex = facts.families.indexOf('torque wrench')
  assert.ok(torqueIndex !== -1)
  assert.ok(!facts.families.includes('wrench'), 'generic word folded into the bigram')
  assert.ok(!facts.families.includes('duty pipe'), 'mid-chain artifact removed')
  assert.ok(facts.families.includes('heavy duty'), 'equal-count prefix phrase')
})

test('hubProductFacts keeps part identity words and drops noise words', () => {
  const facts = hubProductFacts(
    Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Bearing Puller Kit No. ${i + 1}` })),
    { exclude: [] },
  )
  // Equal popularity collapses to ONE representative — here the most
  // specific phrase the four identical names support.
  assert.equal(facts.families.length, 1, 'equal-count phrases collapse to one representative')
  assert.match(facts.families[0], /bearing/, 'the family phrase carries real part identity')
  assert.ok(!facts.families.includes('marine'))
  assert.ok(!facts.families.some((phrase) => /^\d+$/.test(phrase)), 'no bare-number phrases')
})

test('hubCoverageSentence gates itself below three families', () => {
  assert.equal(hubCoverageSentence('PROTO', CATALOGUE_SAMPLE.slice(0, 2)), '')
  const sentence = hubCoverageSentence('PROTO', CATALOGUE_SAMPLE)
  assert.match(sentence, /^Common part families covered: /)
  assert.match(sentence, /, and | and /)
  assert.match(sentence, /request a quote for a part that is not listed\.$/)
  for (const family of sentence.match(/^Common part families covered: (.+?)\./)?.[1].split(', ') || []) {
    assert.ok(!/proto/i.test(family), 'brand word must not leak into brand hub families')
  }
})

test('hubCoverageSentence keeps deployed catalogue text out of the sentence', () => {
  const sentence = hubCoverageSentence('PROTO', [
    ...CATALOGUE_SAMPLE,
    { id: '9', name: 'Computed torque wrench calibrated' },
    { id: '10', name: 'Torque wrench check tool' },
  ])
  assert.ok(!/undefined|NaN/.test(sentence), 'no JavaScript leakage from sparse fields')
})

const serverSource = readFileSync('server.js', 'utf8')
const brandHubSource = readFileSync('src/pages/BrandHub.tsx', 'utf8')
const categoryHubSource = readFileSync('src/pages/CategoryHub.tsx', 'utf8')

test('server.js hubHtml renders the same shared builder, not a local copy', () => {
  assert.match(serverSource, /hubCoverageSentence/, 'server.js imports the shared builder')
  assert.match(serverSource, /import {[^}]*hubCoverageSentence[^}]*} from '\.\/shared\/product-page\.mjs'/)
  assert.match(serverSource, /escapeHtml\(coverage\)/, 'sentence is HTML-escaped in the SSR body')
})

test('React hub pages render the same shared builder', () => {
  for (const [name, source] of [['BrandHub', brandHubSource], ['CategoryHub', categoryHubSource]]) {
    assert.match(source, /from '\.\.\/\.\.\/shared\/product-page\.mjs'/, `${name} must import the shared module`)
    assert.match(source, /hubCoverageSentence\(/, `${name} must call the shared builder`)
  }
})

test('the production normalizer uses the backend twin, never shared/', () => {
  const script = readFileSync('backend/scripts/normalize-product-names.ts', 'utf8')
  assert.match(script, /productNameClean\.js/, 'api image only contains backend/ — import the twin')
  assert.doesNotMatch(script, /from ['"]\.\.\/\.\.\/shared\//, 'railway api build context cannot resolve ../shared imports')
  assert.match(script, /productSlugHistory\.upsert/, 'renames must leave a 301 redirect row')
  assert.match(script, /contentUpdatedAt/, 'changed rows must bump content_updated_at like the admin form')
})
