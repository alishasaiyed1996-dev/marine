/**
 * Tests for the reference copy used to fill empty brand-hub SEO fields.
 * The generated copy must always pass the hub indexability gate in
 * src/utils/hubSeo.ts: description ≥ 120 chars, an SEO title, and an SEO
 * description ≥ 80 chars — for every realistic brand name and count.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrandHubCopy } from '../utils/brandHubCopy.js'

const gate = (name: string, count: number, categories: string[]) =>
  buildBrandHubCopy({ brandName: name, productCount: count, categories })

test('copy passes the hubSeo indexability thresholds for short names', () => {
  const copy = gate('PROTO', 214, ['Hand Tools', 'Torque Wrenches', 'Sockets'])
  assert.ok(copy.description.length >= 120, `description ${copy.description.length} < 120`)
  assert.ok(copy.seoDescription.length >= 80, `seoDescription ${copy.seoDescription.length} < 80`)
  assert.equal(copy.seoTitle, 'PROTO spare parts | Alka Traders')
  assert.ok(copy.description.includes('214'), 'the product count must appear in the description')
  assert.ok(copy.description.includes('Hand Tools'), 'real categories must appear in the description')
})

test('copy works with the smallest count and no categories', () => {
  const copy = gate('GEDORE', 1, [])
  assert.ok(copy.description.length >= 120)
  assert.ok(copy.seoDescription.length >= 80)
  assert.ok(copy.description.includes('marine and industrial range'))
})

test('at most four categories are woven into the description', () => {
  const copy = gate('WIKA', 30, ['Pressure', 'Temperature', 'Sensors', 'Valves', 'Extra A', 'Extra B'])
  for (const category of ['Pressure', 'Temperature', 'Sensors', 'Valves']) {
    assert.ok(copy.description.includes(category))
  }
  assert.ok(!copy.description.includes('Extra A'), 'the fifth category must not appear')
})

test('long brand names drop the suffix instead of a truncated title', () => {
  const long = 'Parker Hannifin Hydraulic & Pneumatic Systems Division'
  const copy = gate(long, 5, ['Hoses'])
  assert.ok(copy.seoTitle.length > 0)
  assert.ok(copy.seoTitle.length <= 70, `seoTitle ${copy.seoTitle.length} too long for a SERP`)
  assert.equal(copy.seoTitle, `${long} spare parts`)
})

test('700-product brand still satisfies every threshold', () => {
  const copy = gate('RIDGID', 700, ['Pipe Tools', 'Draining'])
  assert.ok(copy.description.length >= 120)
  assert.ok(copy.seoDescription.length >= 80)
  assert.ok(copy.seoTitle.length > 0)
})
