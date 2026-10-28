/**
 * eBay order processing tests (roadmap C32).
 * Run: cd backend && npx tsx --test src/services/ebayOrderService.test.ts
 *
 * node:test, matching the project's offerRules test convention. The full DB
 * flows (stock claim, duplicate events) are covered by the smoke script
 * against a live server; these tests pin the pure decision logic and the
 * idempotency semantics of the processor's pure parts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOrderId, extractEventId, extractTopic, sellableOnEbay, skuCandidates } from './ebayOrderEvents.js'
import { isRetryableError } from './ebayClient.js'

// ── extractOrderId across notification shapes ──────────────────

test('extractOrderId reads the direct orderId', () => {
  assert.equal(extractOrderId({ orderId: '12-34567-89012' }), '12-34567-89012')
})

test('extractOrderId reads snake_case order_id', () => {
  assert.equal(extractOrderId({ order_id: '12-34567-89012' }), '12-34567-89012')
})

test('extractOrderId reads nested data.orderId', () => {
  assert.equal(extractOrderId({ data: { orderId: '12-1' } }), '12-1')
})

test('extractOrderId reads nested resource.orderId', () => {
  assert.equal(extractOrderId({ resource: { orderId: '12-2' } }), '12-2')
})

test('extractOrderId returns undefined when absent', () => {
  assert.equal(extractOrderId({ foo: 'bar' }), undefined)
})

test('extractEventId prefers notificationId', () => {
  assert.equal(extractEventId({ notificationId: 'abc-1', eventId: 'x' }), 'abc-1')
})

// ── Real EPN envelope (metadata + notification wrapper) ────────

test('extractTopic reads metadata.topic from the real EPN envelope', () => {
  assert.equal(extractTopic({ metadata: { topic: 'ORDER.CREATED' }, notification: {} }), 'ORDER.CREATED')
  assert.equal(extractTopic({ topic: 'flat.topic' }), 'flat.topic')
  assert.equal(extractTopic({ eventType: 'flat.event' }), 'flat.event')
  assert.equal(extractTopic({}), undefined)
})

test('extractEventId reads notification.notificationId from the real EPN envelope', () => {
  assert.equal(extractEventId({ notification: { notificationId: 'f4a7f0c8-4f71-4b52-9c2e' } }), 'f4a7f0c8-4f71-4b52-9c2e')
})

test('extractOrderId reads notification.data.orderId from the real EPN envelope', () => {
  const payload = {
    metadata: { topic: 'ORDER.CREATED' },
    notification: { notificationId: 'evn-1', data: { orderId: '05-15306-81809' } },
  }
  assert.equal(extractOrderId(payload), '05-15306-81809')
})

test('envelope extraction ignores a compliance payload without an order', () => {
  const payload = {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
    notification: { notificationId: 'evn-2', data: { username: 'u', userId: 'id' } },
  }
  assert.equal(extractOrderId(payload), undefined)
  assert.equal(extractEventId(payload), 'evn-2')
})

// ── retry classification drives the defer-vs-fail split ────────

test('isRetryableError: 5xx and 429 are temporary', () => {
  assert.equal(isRetryableError(new Error('eBay getOrder failed (503): busy')), true)
  assert.equal(isRetryableError(new Error('eBay updateOffer failed (429): rate limited')), true)
})

test('isRetryableError: network errors are temporary', () => {
  assert.equal(isRetryableError(new Error('fetch failed: ECONNRESET')), true)
  assert.equal(isRetryableError(new Error('ETIMEDOUT')), true)
})

test('isRetryableError: 404 and validation errors are permanent', () => {
  assert.equal(isRetryableError(new Error('eBay getOrder failed (404): not found')), false)
  assert.equal(isRetryableError(new Error('eBay updateOffer failed (400): bad request')), false)
})

// ── skuCandidates: eBay SKU → website product matching ─────────

test('skuCandidates normalizes Seller-Hub whitespace drift', () => {
  assert.deepEqual(skuCandidates(' C 126 '), [' C 126 ', 'C 126'])
  assert.deepEqual(skuCandidates('Z  40'), ['Z  40', 'Z 40'])
})

test('skuCandidates keeps exact SKUs intact and deduplicates', () => {
  assert.deepEqual(skuCandidates('Z 40'), ['Z 40'])
  assert.deepEqual(skuCandidates('IMP-A/2"'), ['IMP-A/2"'])
  assert.deepEqual(skuCandidates(''), [])
})

// ── sellableOnEbay: which products may claim stock on an eBay sale ──

test('sellableOnEbay lets mirror-managed draft/hidden products claim', () => {
  // Imported items are drafts until the publish gate passes; they still sell
  // on eBay the whole time and stock must stay correct.
  assert.equal(sellableOnEbay({ status: 'draft' }, { status: 'synced' }), true)
  assert.equal(sellableOnEbay({ status: 'hidden' }, { status: 'sync-pending' }), true)
  assert.equal(sellableOnEbay({ status: 'published' }, { status: 'sync-failed' }), true)
})

test('sellableOnEbay falls back to published-only without a mirror row', () => {
  // An eBay listing created outside this system that merely matches a website
  // SKU: only a published catalog product is claimed — never guess membership.
  assert.equal(sellableOnEbay({ status: 'published' }, null), true)
  assert.equal(sellableOnEbay({ status: 'draft' }, null), false)
  assert.equal(sellableOnEbay({ status: 'hidden' }, null), false)
  assert.equal(sellableOnEbay(null, null), false)
})

test('sellableOnEbay refuses archived products and trusting mirror rows over their status', () => {
  // Archived ends the relationship entirely.
  assert.equal(sellableOnEbay({ status: 'archived' }, { status: 'synced' }), false)
  // Row status is irrelevant: an order placed before an admin ended the
  // listing can arrive afterwards (webhook retry / poll) and must claim.
  assert.equal(sellableOnEbay({ status: 'published' }, { status: 'ended' }), true)
  assert.equal(sellableOnEbay({ status: 'draft' }, { status: 'ended' }), true)
  assert.equal(sellableOnEbay({ status: 'draft' }, { status: 'pending' }), true)
})
