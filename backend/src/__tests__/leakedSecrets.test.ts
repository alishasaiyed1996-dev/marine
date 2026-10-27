import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isKnownLeakedSecret, leakedSecretKeys, PROTECTED_SECRET_KEYS } from '../utils/env.js'

/**
 * B1 — the production denylist for secrets that were committed to git history.
 *
 * The denylist stores SHA-256 hashes only (never plaintext). The real leaked
 * hash cannot be tested against its plaintext — only its hash is known, by
 * design — so these tests inject a synthetic denylist and verify the matching
 * and coverage logic end to end.
 */

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

test('all three leaked secrets are protected: JWT_SECRET, CSRF_SECRET, ADMIN_PASSWORD', () => {
  assert.deepEqual([...PROTECTED_SECRET_KEYS], ['JWT_SECRET', 'CSRF_SECRET', 'ADMIN_PASSWORD'])
})

test('a value matching a denylisted hash is detected', () => {
  const plaintext = 'test-only-retired-secret-value'
  assert.equal(isKnownLeakedSecret(plaintext, new Set([sha256(plaintext)])), true)
})

test('a clean value is never a false positive against the real denylist', () => {
  assert.equal(isKnownLeakedSecret('a-fresh-openssl-rand-value'), false)
  assert.equal(isKnownLeakedSecret(''), false)
  assert.equal(isKnownLeakedSecret(undefined), false)
})

test('leakedSecretKeys reports every protected key that matches', () => {
  const leaked = 'leaked-value-one'
  const hashes = new Set([sha256(leaked)])
  const found = leakedSecretKeys(
    { JWT_SECRET: leaked, CSRF_SECRET: 'clean', ADMIN_PASSWORD: leaked },
    hashes,
  )
  assert.deepEqual(found, ['JWT_SECRET', 'ADMIN_PASSWORD'])
})

test('leakedSecretKeys returns an empty list for a clean environment', () => {
  const hashes = new Set([sha256('leaked-value-one')])
  assert.deepEqual(
    leakedSecretKeys({ JWT_SECRET: 'x', CSRF_SECRET: 'y', ADMIN_PASSWORD: 'z' }, hashes),
    [],
  )
})

test('missing ADMIN_PASSWORD alone does not trip the denylist', () => {
  const hashes = new Set([sha256('leaked-value-one')])
  assert.deepEqual(leakedSecretKeys({ ADMIN_PASSWORD: undefined }, hashes), [])
})
