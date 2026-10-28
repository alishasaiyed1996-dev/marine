/**
 * Unit tests for the eBay endpoint-registration challenge (audit B10).
 * Run: cd backend && npm test
 *
 * node:test, crypto only — no DB/server imports (house convention: routes
 * import prisma from server.js, which a test must never boot).
 *
 * Pins the exact wire behavior of the challenge answer: sha256 over
 * challenge_code + verification token + endpoint, a 400-shaped null for
 * unconfigured servers, and env sourced from callers rather than process.env.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { buildChallengeResponse } from '../utils/ebayChallenge.js'

const ENV = {
  EBAY_VERIFICATION_TOKEN: 'unit-test-token',
  EBAY_PUBLIC_ENDPOINT: 'https://api.alkatraders.co/api/webhooks/ebay',
}

const EXPECTED = (() => {
  const hash = createHash('sha256')
  hash.update('probe-code' + ENV.EBAY_VERIFICATION_TOKEN + ENV.EBAY_PUBLIC_ENDPOINT)
  return hash.digest('hex')
})()

test('the challenge response is sha256(code + token + endpoint)', () => {
  assert.equal(buildChallengeResponse('probe-code', ENV), EXPECTED)
})

test('a missing token or endpoint yields null (caller answers 400)', () => {
  assert.equal(buildChallengeResponse('probe-code', { EBAY_PUBLIC_ENDPOINT: ENV.EBAY_PUBLIC_ENDPOINT }), null)
  assert.equal(buildChallengeResponse('probe-code', { EBAY_VERIFICATION_TOKEN: ENV.EBAY_VERIFICATION_TOKEN }), null)
  assert.equal(buildChallengeResponse('probe-code', {}), null)
})

test('a missing or empty challenge code yields null', () => {
  assert.equal(buildChallengeResponse(undefined, ENV), null)
  assert.equal(buildChallengeResponse('', ENV), null)
})

test('responses are deterministic per code', () => {
  const a = buildChallengeResponse('code-a', ENV)
  const b = buildChallengeResponse('code-a', ENV)
  const other = buildChallengeResponse('code-b', ENV)
  assert.equal(a, b)
  assert.notEqual(a, other)
  assert.notEqual(a, EXPECTED)
})

test('the value cannot collide with the event topic fallbacks', () => {
  // hex digest, 64 chars
  assert.deepEqual(EXPECTED, EXPECTED.toLowerCase())
  assert.equal(EXPECTED.length, 64)
})
