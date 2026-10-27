import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * PayPal order-creation gates (2026-10-28 "PayPal only" decision).
 *
 * `orderMutations.ts` and `offerService.ts` import prisma through `../server.js`,
 * which listens unconditionally when imported — so, like brandLogoUpload.test.ts,
 * these tests assert the SOURCE. They pin that both order-creating paths refuse
 * to create an order PayPal cannot pay for.
 */

const here = path.dirname(fileURLToPath(import.meta.url))

const readSource = (...segments: string[]): string =>
  fs.readFileSync(path.resolve(here, '..', ...segments), 'utf8')

test('bankDetailsService resolves PayPal payable as credentials AND not-disabled blob', () => {
  const source = readSource('services', 'bankDetailsService.ts')
  assert.ok(
    source.includes('isPaypalMethodEnabled(blob)'),
    'isPaypalPayable must consult the admin payment-methods blob',
  )
  assert.ok(
    source.includes('if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) return false'),
    'isPaypalPayable must require both PayPal credentials',
  )
})

test('storefront order creation gates paypal like the offline methods', () => {
  const source = readSource('services', 'orderMutations.ts')
  // The gate lives in buildPaymentInstructions, which runs before the order is
  // written — an unpayable order must never be created.
  const gate = source.match(
    /if \(!isBankPaymentMethod\(paymentMethod\)\) \{[\s\S]*?isPaypalPayable\(\)[\s\S]*?'PayPal is not available at the moment[\s\S]*?\{ status: 409 \}[\s\S]*?return null/,
  )
  assert.ok(gate, 'non-offline methods must be gated on isPaypalPayable() with a 409 before returning null')
  assert.ok(
    source.includes('isPaypalPayable') && source.includes('buildPaymentInstructions(paymentMethod'),
    'createOrder must run the gate through buildPaymentInstructions before writing the order',
  )
})

test('the accepted-offer order path is gated too (it bypasses createOrder)', () => {
  const source = readSource('services', 'offerService.ts')
  assert.ok(
    source.includes("import { isPaypalPayable } from './bankDetailsService.js'"),
    'offerService must import the shared PayPal gate',
  )
  // The gate must sit in createOfferOrder BEFORE the awaiting-payment flip —
  // an offer must never be locked into an unpayable order.
  const gateIndex = source.indexOf('isPaypalPayable()')
  const flipIndex = source.indexOf("status: 'awaiting-payment'")
  assert.ok(gateIndex !== -1 && flipIndex !== -1, 'both the gate and the awaiting-payment flip must exist')
  assert.ok(gateIndex < flipIndex, 'createOfferOrder must check PayPal availability before flipping the offer to awaiting-payment')
})
