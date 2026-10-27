/**
 * Tests for the Search Console audit tooling.
 *
 * These verify the dependency-free service-account auth actually produces a
 * valid RS256 JWT (signed by a throwaway keypair) and that URL/result parsing
 * is correct — none of which needs Google credentials.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { buildJwt, loadServiceAccount, parseSitemapLocs, flattenInspection } from '../scripts/gsc-index-audit.mjs'

function makeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return {
    client_email: 'seo-audit@example.iam.gserviceaccount.com',
    private_key: privateKey,
    private_key_id: 'key-123',
  }
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

test('buildJwt produces a three-part RS256 assertion', () => {
  const sa = makeServiceAccount()
  const jwt = buildJwt(sa, 1_700_000_000)
  const parts = jwt.split('.')
  assert.equal(parts.length, 3, 'JWT must have header.payload.signature')

  const header = decodeSegment(parts[0])
  assert.equal(header.alg, 'RS256')
  assert.equal(header.typ, 'JWT')
  assert.equal(header.kid, 'key-123', 'kid must come from private_key_id')

  const claims = decodeSegment(parts[1])
  assert.equal(claims.iss, sa.client_email)
  assert.equal(claims.iat, 1_700_000_000)
  assert.equal(claims.exp, 1_700_000_000 + 3600)
  assert.match(claims.scope, /webmasters/)
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token')
})

test('buildJwt signature verifies against the matching public key', () => {
  const sa = makeServiceAccount()
  const jwt = buildJwt(sa, 1_700_000_000)
  const [header, payload, signature] = jwt.split('.')

  const publicKey = crypto.createPublicKey({ key: sa.private_key, format: 'pem' })

  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(`${header}.${payload}`)
  const ok = verifier.verify(
    publicKey,
    Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  )
  assert.equal(ok, true, 'signature must verify with the service-account public key')
})

test('buildJwt rejects an incomplete service account', () => {
  assert.throws(() => buildJwt({ private_key: 'x' }), /client_email/)
  assert.throws(() => buildJwt({ client_email: 'a@b.c' }), /private_key/)
})

test('loadServiceAccount reads the inline JSON env var', () => {
  const original = process.env.GSC_SERVICE_ACCOUNT_JSON
  try {
    process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y.z', private_key: 'k' })
    const sa = loadServiceAccount()
    assert.equal(sa.client_email, 'x@y.z')

    process.env.GSC_SERVICE_ACCOUNT_JSON = 'not json'
    assert.throws(() => loadServiceAccount(), /not valid JSON/)
  } finally {
    if (original === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON
    else process.env.GSC_SERVICE_ACCOUNT_JSON = original
  }
})

test('parseSitemapLocs ignores image URLs and de-duplicates', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://alkatraders.co/en/</loc>
  </url>
  <url>
    <loc>https://alkatraders.co/en/product/widget/</loc>
    <image:image>
      <image:loc>https://res.cloudinary.com/demo/widget.jpg</image:loc>
    </image:image>
  </url>
  <url>
    <loc>https://alkatraders.co/en/</loc>
  </url>
</urlset>`

  const locs = parseSitemapLocs(xml)
  assert.deepEqual(locs, [
    'https://alkatraders.co/en/',
    'https://alkatraders.co/en/product/widget/',
  ])
  assert.ok(!locs.some((l) => l.includes('cloudinary')), 'image URLs must not be treated as pages')
})

test('flattenInspection maps the inspection payload', () => {
  const result = {
    indexStatusResult: {
      verdict: 'PASS',
      coverageState: 'Submitted and indexed',
      indexingState: 'INDEXING_ALLOWED',
      robotsTxtState: 'ALLOWED',
      pageFetchState: 'SUCCESSFUL',
      lastCrawlTime: '2026-10-26T10:00:00Z',
      crawledAs: 'MOBILE',
      userCanonical: 'https://alkatraders.co/en/product/widget/',
      googleCanonical: 'https://alkatraders.co/en/product/widget/',
    },
    mobileUsabilityResult: { verdict: 'PASS' },
    richResultsResult: { verdict: 'PASS', detectedItems: [{ richResultType: 'Product snippets' }] },
  }

  const flat = flattenInspection('https://alkatraders.co/en/product/widget/', result)
  assert.equal(flat.verdict, 'PASS')
  assert.equal(flat.coverageState, 'Submitted and indexed')
  assert.equal(flat.canonicalMatch, 'true')
  assert.equal(flat.richDetected, 'Product snippets')

  const mismatch = flattenInspection('https://alkatraders.co/en/product/widget/', {
    indexStatusResult: {
      coverageState: 'Duplicate, Google chose different canonical',
      userCanonical: 'https://alkatraders.co/en/product/widget/',
      googleCanonical: 'https://alkatraders.co/en/product/other/',
    },
  })
  assert.equal(mismatch.canonicalMatch, 'false')

  const empty = flattenInspection('https://alkatraders.co/en/', {})
  assert.equal(empty.verdict, '')
  assert.equal(empty.canonicalMatch, '', 'no canonical info must not be reported as a match')
})
