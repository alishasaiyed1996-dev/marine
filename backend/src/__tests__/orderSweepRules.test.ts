/**
 * Unit tests for the stale-checkout stock sweep rules (audit B10).
 * Run: cd backend && npm test
 *
 * node:test, pure module — no DB/server imports (house convention).
 *
 * Pins exactly which orders are swept: only PayPal checkouts that are still
 * pending forever AND untouched recently — a bank-transfer order waiting for
 * admin confirmation must never be swept, and a reservation a live capture
 * path just claimed (updated a moment ago) must never be released mid-flight.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SWEEP_INTERVAL_MINUTES,
  DEFAULT_SWEEP_WINDOW,
  isSweepCandidate,
  sweepIntervalFromEnv,
  sweepWindowFromEnv,
} from '../services/orderSweepRules.js'

const NOW = new Date('2026-10-28T12:00:00Z')

function candidate(overrides: Partial<Parameters<typeof isSweepCandidate>[0]> = {}, ageHours = 48) {
  return {
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    status: 'pending',
    stockReserved: true,
    createdAt: new Date(NOW.getTime() - ageHours * 3_600_000),
    updatedAt: new Date(NOW.getTime() - 48 * 3_600_000),
    ...overrides,
  } as Parameters<typeof isSweepCandidate>[0]
}

test('a stale unpaid PayPal checkout with claimed stock is a sweep candidate', () => {
  assert.equal(isSweepCandidate(candidate(), NOW), true)
})

test('the boundary inside the stale window is excluded', () => {
  // created 23h ago with the default 24h window → too fresh
  assert.equal(isSweepCandidate(candidate({}, 23), NOW), false)
})

test('a bank-transfer order is never swept, however old', () => {
  assert.equal(isSweepCandidate(candidate({ paymentMethod: 'bank_transfer' }), NOW), false)
  assert.equal(isSweepCandidate(candidate({ paymentMethod: 'letter_of_credit' }, 24 * 30), NOW), false)
  assert.equal(isSweepCandidate(candidate({ paymentMethod: null }, 24 * 30), NOW), false)
})

test('a paid/confirmed/cancelled order is never swept', () => {
  assert.equal(isSweepCandidate(candidate({ paymentStatus: 'paid' }), NOW), false)
  assert.equal(isSweepCandidate(candidate({ status: 'confirmed' }), NOW), false)
  assert.equal(isSweepCandidate(candidate({ status: 'cancelled' }), NOW), false)
})

test('an order with no claimed stock is never swept', () => {
  assert.equal(isSweepCandidate(candidate({ stockReserved: false }), NOW), false)
})

test('a reservation touched inside the quiet window is never swept (capture race guard)', () => {
  const justClaimed = candidate({ updatedAt: new Date(NOW.getTime() - 30 * 60_000) })
  assert.equal(isSweepCandidate(justClaimed, NOW), false)
})

test('a custom window is honored (stale=2h, quiet=10m)', () => {
  const window = { staleHours: 2, quietMinutes: 10 }
  const twoHoursOld = candidate({}, 2)
  // exactly at the boundary → excluded; a second later → included
  assert.equal(isSweepCandidate(twoHoursOld, NOW, window), false)
  const twoHoursOneSecond = candidate(
    { createdAt: new Date(NOW.getTime() - 2 * 3_600_000 - 1000) },
  )
  assert.equal(isSweepCandidate(twoHoursOneSecond, NOW, window), true)
})

test('boolean misuse (string stockReserved) is rejected defensively', () => {
  // @ts-expect-error synthetic row from a hand-rolled projection
  assert.equal(isSweepCandidate(candidate({ stockReserved: 'true' }), NOW), false)
})

test('env parsing: junk values fall back to the defaults', () => {
  assert.deepEqual(
    sweepWindowFromEnv({ ORDER_SWEEP_STALE_HOURS: 'not-a-number', ORDER_SWEEP_QUIET_MINUTES: '' }),
    DEFAULT_SWEEP_WINDOW,
  )
  assert.equal(sweepIntervalFromEnv({ ORDER_SWEEP_INTERVAL_MINUTES: 'zero' }), DEFAULT_SWEEP_INTERVAL_MINUTES)
  assert.equal(sweepIntervalFromEnv({ ORDER_SWEEP_INTERVAL_MINUTES: '-40' }), DEFAULT_SWEEP_INTERVAL_MINUTES)
})

test('env parsing: sound overrides apply and the interval floor holds', () => {
  assert.deepEqual(
    sweepWindowFromEnv({ ORDER_SWEEP_STALE_HOURS: '48', ORDER_SWEEP_QUIET_MINUTES: '15' }),
    { staleHours: 48, quietMinutes: 15 },
  )
  // below the 5-minute floor → clamped, not trusted
  assert.equal(sweepIntervalFromEnv({ ORDER_SWEEP_INTERVAL_MINUTES: '2' }), 5)
})
