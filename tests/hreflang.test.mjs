import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hreflangAlternatesFor } from '../shared/route-i18n.mjs'

/**
 * S6 — hreflang alternates in page heads must match the sitemap EXACTLY.
 *
 * backend/src/services/sitemapService.ts (the sitemap the audit verified
 * live) emits xhtml:link alternates ONLY for the translated static routes:
 * every shipped locale (en, ar, es) plus x-default pointing at the English
 * page. Products and brand/category hubs are listed WITHOUT alternates.
 * The prerenderer used to stamp en/ar/es + x-default on every page including
 * products — declaring ar/es alternates that are noindex or nonexistent.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const BASE = 'https://alkatraders.co'

test('a prerendered product page carries NO hreflang alternates (the sitemap lists none for products)', () => {
  assert.deepEqual(hreflangAlternatesFor('/en/product/teryair-hose-fitting/', BASE), [])
  // Also from the absolute canonical form the runtime server passes in.
  assert.deepEqual(
    hreflangAlternatesFor(`${BASE}/en/product/teryair-hose-fitting/`, BASE),
    [],
  )
})

test('a translated static route carries en/ar/es + x-default, all pointing at /en/ for x-default', () => {
  const links = hreflangAlternatesFor('/en/products/', BASE)
  assert.deepEqual(links.map((link) => link.hreflang), ['en', 'ar', 'es', 'x-default'])
  assert.deepEqual(links.map((link) => link.href), [
    `${BASE}/en/products/`,
    `${BASE}/ar/products/`,
    `${BASE}/es/products/`,
    `${BASE}/en/products/`,
  ])
})

test('the alternate set is reciprocal across locales (AR page == EN page == ES page)', () => {
  const en = hreflangAlternatesFor('/en/rfq/', BASE)
  const ar = hreflangAlternatesFor('/ar/rfq/', BASE)
  const es = hreflangAlternatesFor('/es/rfq/', BASE)
  assert.deepEqual(ar, en)
  assert.deepEqual(es, en)
})

test('hubs and private routes get no alternates, like the sitemap', () => {
  assert.deepEqual(hreflangAlternatesFor('/en/brands/abb/', BASE), [])
  assert.deepEqual(hreflangAlternatesFor('/en/categories/pumps/', BASE), [])
  assert.deepEqual(hreflangAlternatesFor('/en/checkout/', BASE), [])
})

test('prerender.mjs and server.js emit hreflang through the shared policy, not local copies', () => {
  const prerenderSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'prerender.mjs'), 'utf8')
  assert.ok(
    prerenderSource.includes("from '../shared/route-i18n.mjs'") &&
    prerenderSource.includes('hreflangAlternatesFor('),
    'prerender.mjs must build hreflang tags from shared/route-i18n.mjs',
  )
  const serverSource = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8')
  assert.ok(
    serverSource.includes('hreflangAlternatesFor('),
    'server.js renderDocument must emit the shared alternates policy',
  )
})

/**
 * The literal audit check: ONE prerendered product page on disk. Skips when
 * the dist has not been built (CI runs without a build).
 */
test('the prerendered product page in dist declares no hreflang alternates', (t) => {
  const dist = path.join(repoRoot, 'frontend', 'dist')
  const productsDir = path.join(dist, 'en', 'product')
  if (!fs.existsSync(productsDir)) {
    // node:assert has no `skip` — the test runner context does. (assert.skip
    // used to throw a TypeError here, failing the run instead of skipping.)
    t.skip('frontend/dist not built — run npm run build first')
    return
  }
  const [productDir] = fs
    .readdirSync(productsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
  assert.ok(productDir, 'at least one prerendered product page expected')
  const html = fs.readFileSync(
    path.join(productsDir, productDir.name, 'index.html'),
    'utf8',
  )
  assert.ok(!html.includes('hreflang='), 'product pages must not declare hreflang alternates')
  // Translated static pages DO declare the full set — sanity-check one.
  const productsHub = fs.readFileSync(path.join(dist, 'en', 'products', 'index.html'), 'utf8')
  for (const locale of ['en', 'ar', 'es', 'x-default']) {
    assert.ok(productsHub.includes(`hreflang="${locale}"`), `products hub must declare ${locale}`)
  }
})
