/**
 * Related-product pick rules (pure module — no DB imports).
 * Run: cd backend && npx tsx --test src/services/relatedProductRules.test.ts
 *
 * Pins the fill order and the never-self/never-duplicate guarantees behind
 * the per-request rotation on product detail pages.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickRelatedIds, relatedPoolSize } from './relatedProductRules.js'

test('category evidence leads, brand fills second, newest only as fallback', () => {
  const ids = pickRelatedIds('self', ['cat-1', 'cat-2'], ['brand-1', 'brand-2'], ['new-1', 'new-2'], 4)
  assert.deepEqual(ids, ['cat-1', 'cat-2', 'brand-1', 'brand-2'])
})

test('the current product never appears in its own related list', () => {
  const ids = pickRelatedIds('self', ['self', 'cat-1'], ['self', 'brand-1'], ['self', 'new-1'], 4)
  assert.deepEqual(ids, ['cat-1', 'brand-1', 'new-1'])
})

test('no duplicates between pools — a row found twice is listed once', () => {
  const ids = pickRelatedIds('self', ['cat-1', 'shared'], ['shared', 'brand-1'], ['brand-1'], 4)
  assert.deepEqual(ids, ['cat-1', 'shared', 'brand-1'])
})

test('pools are consumed in order until `take` selections are made', () => {
  const ids = pickRelatedIds(
    'self',
    ['c1', 'c2', 'c3', 'c4', 'c5'],
    ['b1', 'b2', 'b3'],
    ['n1', 'n2'],
    4,
  )
  assert.deepEqual(ids, ['c1', 'c2', 'c3', 'c4'])
})

test('short pools fall back to newest rows so the row always fills', () => {
  const ids = pickRelatedIds('self', [], [], ['n1', 'n2', 'n3', 'n4'], 4)
  assert.deepEqual(ids, ['n1', 'n2', 'n3', 'n4'])
})

test('an orphan product with no evidence anywhere yields no picks', () => {
  assert.deepEqual(pickRelatedIds('self', [], [], [], 4), [])
})

test('pool size scales with take and never drops below a floor', () => {
  assert.equal(relatedPoolSize(4), 24)
  assert.equal(relatedPoolSize(2), 18)
  assert.equal(relatedPoolSize(8), 48)
})
