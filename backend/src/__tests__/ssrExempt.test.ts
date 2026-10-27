/**
 * Tests for the SSR rate-limit exemption used by publicLimiter.
 *
 * The web service renders product/hub pages server-side, so its API fetches
 * all originate from one IP and would otherwise trip the public visitors'
 * 100 req/min limit during a crawler burst — the 429 becomes a 503 + noindex
 * page on the frontend (SEO_RANKING_RESEARCH.md §1). The skip must therefore:
 *   - activate ONLY with the shared token present on both sides,
 *   - apply to read-only GET/HEAD only,
 *   - never be spoofable by a wrong token.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { isSsrRequest, SSR_TOKEN_HEADER } from '../middleware/rateLimit.js'

function request(over: { method?: string; headers?: Record<string, unknown> } = {}) {
  return { method: over.method ?? 'GET', headers: over.headers ?? {} }
}

test('isSsrRequest is active only while SSR_API_TOKEN is configured', () => {
  const original = process.env.SSR_API_TOKEN
  try {
    delete process.env.SSR_API_TOKEN
    assert.equal(isSsrRequest(request({ headers: { [SSR_TOKEN_HEADER]: 'any-token' } })), false,
      'without configuration nothing may be exempted')

    process.env.SSR_API_TOKEN = 'secret-1'
    assert.equal(isSsrRequest(request({ headers: { [SSR_TOKEN_HEADER]: 'secret-1' } })), true)
  } finally {
    if (original === undefined) delete process.env.SSR_API_TOKEN
    else process.env.SSR_API_TOKEN = original
  }
})

test('isSsrRequest rejects a wrong token', () => {
  const original = process.env.SSR_API_TOKEN
  try {
    process.env.SSR_API_TOKEN = 'secret-1'
    assert.equal(isSsrRequest(request({ headers: { [SSR_TOKEN_HEADER]: 'secret-2' } })), false)
    assert.equal(isSsrRequest(request({ headers: { [SSR_TOKEN_HEADER]: 'secret-11' } })), false)
    assert.equal(isSsrRequest(request({ headers: { [SSR_TOKEN_HEADER]: '' } })), false)
    assert.equal(isSsrRequest(request({})), false)
  } finally {
    if (original === undefined) delete process.env.SSR_API_TOKEN
    else process.env.SSR_API_TOKEN = original
  }
})

test('isSsrRequest applies to read-only methods only', () => {
  const original = process.env.SSR_API_TOKEN
  try {
    process.env.SSR_API_TOKEN = 'secret-1'
    const valid = { [SSR_TOKEN_HEADER]: 'secret-1' }
    assert.equal(isSsrRequest(request({ method: 'GET', headers: valid })), true)
    assert.equal(isSsrRequest(request({ method: 'HEAD', headers: valid })), true)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(isSsrRequest(request({ method, headers: valid })), false,
        `${method} requests must stay rate-limited even with the token`)
    }
  } finally {
    if (original === undefined) delete process.env.SSR_API_TOKEN
    else process.env.SSR_API_TOKEN = original
  }
})
