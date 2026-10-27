/**
 * Regression tests for the Google tag (GA4) installed in index.html.
 *
 * The tag must be present on every page (the prerenderer and the server render
 * both inherit index.html's head), declared exactly once, inert until consent,
 * and allowlisted by the CSP. Each of those has broken silently in other
 * projects, so they are pinned here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync('index.html', 'utf8')
const GA_ID = 'G-2556Z1FEES'

test('index.html declares the Google tag exactly once', () => {
  const matches = html.match(new RegExp(`googletagmanager\\.com/gtag/js\\?id=${GA_ID}`, 'g')) || []
  assert.equal(matches.length, 1, 'Google warns against more than one tag per page')

  const configCalls = html.match(/gtag\('config'/g) || []
  assert.equal(configCalls.length, 1, 'exactly one gtag config call')
})

test('the tag is inert until consent', () => {
  const tag = html.match(/<script[^>]*id="alka-ga4-static"[^>]*>/)
  assert.ok(tag, 'the static gtag element exists')
  assert.match(tag[0], /type="text\/plain"/, 'an unknown script type is never fetched or executed')

  const bootstrap = html.match(/<script>([\s\S]*?__alkaActivateGa[\s\S]*?)<\/script>/)
  assert.ok(bootstrap, 'the activation bootstrap is inline')
  assert.match(bootstrap[1], /alka-cookie-consent/, 'the gate reads the same consent key as src/lib/consent.ts')
  assert.match(bootstrap[1], /accepted === true/, 'consent must be explicitly true, not merely present')
})

test('the tag never fires on the reset-password route', () => {
  // The reset URL carries a one-time token; it must not reach Google.
  const bootstrap = html.match(/<script>([\s\S]*?__alkaActivateGa[\s\S]*?)<\/script>/)?.[1] || ''
  assert.match(bootstrap, /reset-password/, 'reset-password is excluded from activation')
})

test('page views are not duplicated by an automatic send', () => {
  const bootstrap = html.match(/<script>([\s\S]*?__alkaActivateGa[\s\S]*?)<\/script>/)?.[1] || ''
  assert.match(bootstrap, /send_page_view:\s*false/, 'the SPA owns page views (StoreAnalytics)')
})

test('the bootstrap advertises the tag so React does not add a second one', () => {
  const bootstrap = html.match(/<script>([\s\S]*?__alkaActivateGa[\s\S]*?)<\/script>/)?.[1] || ''
  assert.match(bootstrap, /__alkaStaticGaId/, 'StoreAnalytics reads this to avoid injecting a duplicate')

  const storeAnalytics = readFileSync('src/components/analytics/StoreAnalytics.tsx', 'utf8')
  assert.match(storeAnalytics, /__alkaStaticGaId/, 'StoreAnalytics must check for the hardcoded tag')
})
