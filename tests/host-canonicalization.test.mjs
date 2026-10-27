import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Host canonicalization tests (B3+B4).
 *
 * The audit probed `http://alkatraders.co/en/` and got a 200 — the storefront
 * never bounced plain http. server.js owns the canonicalization middleware;
 * these tests boot the real server on a scratch port and assert:
 *   - http → https 301 keeps path AND query string
 *   - www → apex 301 keeps path and query
 *   - http + www collapse into ONE hop (target is already the https apex URL)
 *   - an https apex request passes through with no redirect
 *   - /health/live and /health/ready never redirect (Railway healthcheck)
 *   - development never redirects (NODE_ENV guard)
 *
 * fetch() is unusable here: undici drops the spoofable Host header as
 * "forbidden". A raw http.request carries Host + x-forwarded-proto — exactly
 * what Railway's edge forwards to the app.
 *
 * Only static routes are requested — no test path reaches the API proxy, so
 * the suite never talks to the production API.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const PORT = String(42000 + Math.floor(Math.random() * 20_000))
const DEV_PORT = String(60000 + Math.floor(Math.random() * 4_000))
const ORIGIN = `http://127.0.0.1:${PORT}`

let child

/** Raw GET with overridable Host / x-forwarded-proto; resolves on response headers. */
function probe(pathname, { host, proto, base = ORIGIN }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${pathname}`,
      { headers: { host, 'x-forwarded-proto': proto } },
      (response) => resolve(response),
    )
    req.on('error', reject)
    req.end()
  })
}

/** Spawn server.js on the given port and wait until it answers /health/live. */
async function bootServer(port, nodeEnv) {
  const spawned = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: port, NODE_ENV: nodeEnv },
    stdio: 'ignore',
  })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(1000) })
      return spawned
    } catch {
      if (spawned.exitCode !== null) throw new Error(`server.js exited early with code ${spawned.exitCode}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  spawned.kill()
  throw new Error(`server.js (NODE_ENV=${nodeEnv}) did not start listening within 10s`)
}

test.before(async () => {
  child = await bootServer(PORT, 'production')
})

test.after(() => {
  child?.kill()
})

test('http → https 301 keeps the path and the query string', async () => {
  const response = await probe('/en/products/?category=pumps&page=2', {
    host: 'alkatraders.co',
    proto: 'http',
  })
  assert.equal(response.statusCode, 301)
  assert.equal(
    response.headers.location,
    'https://alkatraders.co/en/products/?category=pumps&page=2',
  )
  response.resume()
})

test('www → apex 301 keeps the path and the query string', async () => {
  const response = await probe('/en/brands/?x=1', {
    host: 'www.alkatraders.co',
    proto: 'https',
  })
  assert.equal(response.statusCode, 301)
  assert.equal(
    response.headers.location,
    'https://alkatraders.co/en/brands/?x=1',
  )
  response.resume()
})

test('http + www collapses into ONE redirect hop to the https apex', async () => {
  const response = await probe('/en/about/', {
    host: 'www.alkatraders.co',
    proto: 'http',
  })
  assert.equal(response.statusCode, 301)
  // One hop: the Location is already the final https:// apex URL — following
  // it must not produce a second redirect decision.
  assert.equal(response.headers.location, 'https://alkatraders.co/en/about/')
  response.resume()
})

test('an https request to the apex passes through with no redirect', async () => {
  const response = await probe('/en/products/', {
    host: 'alkatraders.co',
    proto: 'https',
  })
  assert.notEqual(response.statusCode, 301)
  assert.notEqual(response.statusCode, 302)
  assert.equal(response.headers.location, undefined)
  response.resume()
})

test('/health/live is never redirected, even over plain http', async () => {
  const response = await probe('/health/live', {
    host: 'alkatraders.co',
    proto: 'http',
  })
  assert.ok(response.statusCode === 200 || response.statusCode === 503)
  assert.equal(response.headers.location, undefined)
  response.resume()
})

test('/health/ready is never redirected, even over plain http', async () => {
  const response = await probe('/health/ready', {
    host: 'alkatraders.co',
    proto: 'http',
  })
  assert.ok(response.statusCode === 200 || response.statusCode === 503)
  assert.equal(response.headers.location, undefined)
  response.resume()
})

test('development never redirects http to https', async () => {
  const dev = await bootServer(DEV_PORT, 'development')
  try {
    const response = await probe('/en/products/?x=1', {
      host: 'alkatraders.co',
      proto: 'http',
      base: `http://127.0.0.1:${DEV_PORT}`,
    })
    assert.notEqual(response.statusCode, 301)
    assert.equal(response.headers.location, undefined)
    response.resume()
  } finally {
    dev.kill()
  }
})
