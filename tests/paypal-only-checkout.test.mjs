import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * PayPal-only checkout (2026-10-28 decision): the store accepts PayPal as its
 * single payment method, so the SDK must render exactly one branded PayPal
 * button — no Venmo, no separate card button. Card payment inside the PayPal
 * popup is PayPal settlement and stays available.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const providerSource = fs.readFileSync(
  path.join(repoRoot, 'src', 'components', 'PayPalProvider.tsx'),
  'utf8',
)

test('the PayPal SDK loads without extra funding buttons (no venmo/card row)', () => {
  assert.ok(!providerSource.includes('enable-funding'), 'enable-funding must not be set — PayPal only')
  assert.ok(!/venmo/i.test(providerSource), 'Venmo must not be enabled anywhere in the provider')
})

test('the SDK still captures with the store settlement currency from the backend', () => {
  assert.ok(providerSource.includes("intent: 'capture'"), 'the SDK must be created with intent capture')
  assert.ok(providerSource.includes('currency,'), 'the SDK currency must come from the backend client-id response')
  assert.ok(providerSource.includes("components: 'buttons'"), 'only the buttons component is needed for checkout')
})

test('the checkout method list stays filtered by genuinely payable methods', () => {
  const listSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'pages', 'checkout', 'CheckoutPayment.tsx'),
    'utf8',
  )
  assert.ok(
    listSource.includes('.filter((m) => availableMethods.includes(m.id))'),
    'payment method cards must be filtered by the available set, never shown unfiltered',
  )
})
