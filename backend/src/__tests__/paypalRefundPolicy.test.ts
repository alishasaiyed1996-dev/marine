/**
 * Unit tests for the PAYMENT.CAPTURE.REFUNDED decision rules (audit B10).
 * Run: cd backend && npm test
 *
 * node:test, pure module — no DB/server imports (house convention).
 *
 * Pins the policy the webhook handler must follow: a full refund moves the
 * payment state, a partial refund never does, and anything unparseable or
 * in a different currency reconciles to nothing instead of guessing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyCaptureRefund } from '../services/paypalRefundPolicy.js'

const ORDER = { total: 120.5, currency: 'USD' }

function refundResource(value: string | number | undefined, currencyCode?: string) {
  return {
    amount: value === undefined ? undefined : { value, currency_code: currencyCode ?? 'USD' },
  }
}

test('a full refund equal to the order total is classifiable as full', () => {
  const c = classifyCaptureRefund(refundResource('120.50'), ORDER)
  assert.equal(c.kind, 'full')
  assert.equal(c.amount, 120.5)
  assert.equal(c.orderTotal, 120.5)
})

test('a numeric amount parses like a string one', () => {
  const c = classifyCaptureRefund(refundResource(120.5), ORDER)
  assert.equal(c.kind, 'full')
})

test('a full refund may overshoot the total slightly (fees) and stays full', () => {
  const c = classifyCaptureRefund(refundResource('120.53'), ORDER)
  assert.equal(c.kind, 'full')
})

test('a refund below the total is partial and must not move payment state', () => {
  const c = classifyCaptureRefund(refundResource('60.00'), ORDER)
  assert.equal(c.kind, 'partial')
  assert.equal(c.amount, 60)
})

test('a refund one cent under the total still reconciles as full (epsilon)', () => {
  const c = classifyCaptureRefund(refundResource('120.49'), { ...ORDER, total: 120.5 })
  assert.equal(c.kind, 'full')
})

test('a different currency can never be reconciled', () => {
  const c = classifyCaptureRefund(refundResource('120.50', 'EUR'), ORDER)
  assert.equal(c.kind, 'unidentifiable')
})

test('a missing amount is unidentifiable, not full', () => {
  const c = classifyCaptureRefund(refundResource(undefined), ORDER)
  assert.equal(c.kind, 'unidentifiable')
  assert.equal(c.amount, null)
})

test('a garbage amount is unidentifiable, not full', () => {
  const c = classifyCaptureRefund(refundResource('abc'), ORDER)
  assert.equal(c.kind, 'unidentifiable')
})

test('a missing resource reconciles to nothing', () => {
  const c = classifyCaptureRefund(null, ORDER)
  assert.equal(c.kind, 'unidentifiable')
})

test('a refund notification without currency_code is still reconcilable (assumes order currency)', () => {
  const c = classifyCaptureRefund({ amount: { value: '120.50' } }, ORDER)
  assert.equal(c.kind, 'full')
})

test('an order without a readable total never acts on a refund', () => {
  const c = classifyCaptureRefund(refundResource('120.50'), { total: NaN, currency: 'USD' })
  assert.equal(c.kind, 'unidentifiable')
})
