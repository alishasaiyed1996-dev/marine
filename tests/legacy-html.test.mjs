import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Legacy .html URL tests (S5).
 *
 * The audit probed `/en/brands.html` → 404 while `/en/brands` → 200. server.js
 * now 301s `/<lang>/<page>.html` to the canonical extensionless URL, but ONLY
 * when the extensionless route actually exists (isKnownStorefrontPath) —
 * unknown paths keep the true 404.
 *
 * Assertions stop AT the 301 (redirect:'manual' semantics): the suite never
 * follows a redirect into the dynamic product handler, so it never talks to
 * the production API.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const PORT = String(46000 + Math.floor(Math.random() * 18_000))
const ORIGIN = `http://127.0.0.1:${PORT}`

function probe(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${ORIGIN}${pathname}`,
      { headers: { host: 'alkatraders.co', 'x-forwarded-proto': 'https' } },
      (response) => resolve(response),
    )
    req.on('error', reject)
    req.end()
  })
}

let child

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT, NODE_ENV: 'production' },
    stdio: 'ignore',
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${ORIGIN}/health/live`, { signal: AbortSignal.timeout(1000) })
      return
    } catch {
      if (child.exitCode !== null) throw new Error(`server.js exited early with code ${child.exitCode}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  child.kill()
  throw new Error('server.js did not start listening within 10s')
})

test.after(() => {
  child?.kill()
})

test('legacy /en/brands.html 301s to the extensionless canonical URL', async () => {
  const response = await probe('/en/brands.html')
  assert.equal(response.statusCode, 301)
  // redirectWithQuery emits relative targets (house style) — safe because the
  // host canonicalization middleware has already forced https://apex.
  assert.equal(response.headers.location, '/en/brands/')
  response.resume()
})

test('the query string survives the .html redirect', async () => {
  const response = await probe('/en/products.html?category=pumps')
  assert.equal(response.statusCode, 301)
  assert.equal(response.headers.location, '/en/products/?category=pumps')
  response.resume()
})

test('a legacy product .html URL 301s to its route shape', async () => {
  // This must 301 BEFORE the /:locale/product/:key handler captures
  // "some-slug.html" as a product key (the pre-fix behaviour was a 404).
  // The assertion stops at the redirect — it is never followed, so no API
  // call is made.
  const response = await probe('/en/product/some-slug.html')
  assert.equal(response.statusCode, 301)
  assert.equal(response.headers.location, '/en/product/some-slug/')
  response.resume()
})

test('an unknown .html path is still a true 404, not a redirect', async () => {
  const response = await probe('/en/no-such-page.html')
  assert.equal(response.statusCode, 404)
  assert.equal(response.headers.location, undefined)
  response.resume()
})

test('the extensionless routes these redirect to actually exist', async () => {
  // Verify, don't assume: /en/brands (no slash) answers 200/whatever but NOT a
  // redirect loop — the target of the S5 redirect must itself be a real route.
  const response = await probe('/en/brands/')
  assert.ok(response.statusCode >= 200 && response.statusCode < 400)
  assert.equal(response.headers.location, undefined)
  response.resume()
})
