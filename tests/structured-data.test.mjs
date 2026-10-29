import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RETURN_POLICY,
  buildMerchantReturnPolicy,
  buildProductPage,
} from '../shared/product-page.mjs'

/**
 * Golden test for product structured data (S-2/S-5).
 *
 * The product JSON-LD used to claim `https://schema.org/FreeReturn` while the
 * Return & Refund Policy says the buyer pays return shipping. Both generators
 * (the prerendered product model and the SPA fallback) now share one helper;
 * these tests assert the policy values and that no layer reintroduces its own
 * copy.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const seoSource = fs.readFileSync(
  path.join(repoRoot, 'src/components/seo/SEO.tsx'),
  'utf8',
)
const productPageSource = fs.readFileSync(
  path.join(repoRoot, 'shared/product-page.mjs'),
  'utf8',
)

/** @param {unknown} value */
function flattenStrings(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(flattenStrings)
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(flattenStrings)
  }
  return []
}

test('the return policy matches the published refund policy', () => {
  const policy = buildMerchantReturnPolicy()

  assert.equal(policy['@type'], 'MerchantReturnPolicy')
  // Buyer-paid return shipping. `FreeReturn` would contradict the refund policy.
  assert.equal(policy.returnFees, 'https://schema.org/ReturnShippingFees')
  assert.equal(policy.returnMethod, 'https://schema.org/ReturnByMail')
  assert.equal(policy.returnPolicyCategory, 'https://schema.org/MerchantReturnFiniteReturnWindow')
  // The refund policy page offers a 30-day window.
  assert.equal(policy.merchantReturnDays, 30)
  // The store sells globally and the refund policy is not country-scoped.
  // An old hard-coded 'IN' made the structured data narrower than the promise.
  assert.equal(policy.applicableCountry, undefined)
})

test('the shared policy constant cannot drift to free returns', () => {
  assert.equal(RETURN_POLICY.returnFees, 'https://schema.org/ReturnShippingFees')
  assert.equal(RETURN_POLICY.returnWindowDays, 30)
  for (const value of flattenStrings(RETURN_POLICY)) {
    assert.ok(
      !value.includes('FreeReturn'),
      'RETURN_POLICY still claims free returns, which the refund policy denies',
    )
  }
})

test('prerendered product JSON-LD carries the shared return policy and no free-return claim', () => {
  const page = buildProductPage(
    {
      id: 'test-1',
      sku: 'IMP-232483',
      name: 'Scupper Plug',
      description: 'Brass scupper plug for deck drainage on commercial vessels and tugs.',
      price: 45,
      currency: 'USD',
      condition: 'used',
      category: 'deck-hardware',
      slug: 'scupper-plug',
    },
    { locale: 'en' },
  )

  const product = page.jsonLd.find((entry) => entry['@type'] === 'Product')
  assert.ok(product, 'no Product JSON-LD generated')
  const policy = product.offers.hasMerchantReturnPolicy
  assert.deepEqual(policy, buildMerchantReturnPolicy())

  for (const value of flattenStrings(page.jsonLd)) {
    assert.ok(
      !value.includes('FreeReturn'),
      'product JSON-LD still claims free returns',
    )
  }
  // The audit also flagged invented shipping destinations; the offer must not
  // assert free shipping to countries the store cannot guarantee.
  assert.equal(product.offers.shippingDetails, undefined)
})

test('the SPA fallback generator delegates to the shared policy instead of its own copy', () => {
  assert.match(
    seoSource,
    /import\s*\{[^}]*buildMerchantReturnPolicy[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/shared\/product-page\.mjs'/,
    'SEO.tsx must import buildMerchantReturnPolicy from the shared engine',
  )
  assert.ok(
    !seoSource.includes('FreeReturn'),
    'SEO.tsx reintroduced a free-return claim',
  )
  assert.ok(
    !seoSource.includes("'https://schema.org/ReturnShippingFees'"),
    'SEO.tsx hardcodes the policy instead of using the shared helper',
  )
  // The value itself must appear in code exactly once, in the shared engine
  // (comments in that file explain the change and are ignored here).
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const codeOccurrences = [
    ...stripComments(productPageSource).matchAll(/ReturnShippingFees/g),
    ...stripComments(seoSource).matchAll(/ReturnShippingFees/g),
  ]
  assert.equal(
    codeOccurrences.length,
    1,
    'the return policy value must be defined once (shared/product-page.mjs)',
  )
})

test('mapCondition maps the 5-value enum explicitly and omits unknown values', () => {
  const build = (condition) =>
    buildProductPage(
      {
        id: 'cond-t',
        sku: 'COND-T-1',
        name: 'Condition Test Bearing',
        description: 'Test part used to verify the JSON-LD condition mapping.',
        price: 10,
        currency: 'USD',
        condition,
        slug: 'condition-test-bearing',
        category: 'engine-spare',
      },
      { locale: 'en' },
    )
  const offers = (condition) => build(condition).jsonLd.find((e) => e['@type'] === 'Product').offers

  assert.equal(offers('used').itemCondition, 'https://schema.org/UsedCondition')
  assert.equal(offers('new').itemCondition, 'https://schema.org/NewCondition')
  assert.equal(offers('unused').itemCondition, 'https://schema.org/NewCondition')
  assert.equal(offers('refurbished').itemCondition, 'https://schema.org/RefurbishedCondition')
  assert.equal(offers('reconditioned').itemCondition, 'https://schema.org/RefurbishedCondition')

  // Unknown / blank → mapper returns undefined and the Offer omits
  // itemCondition entirely: never assert a condition the catalog does not state.
  for (const unknown of ['', null, undefined, 'OEM', 'Overhauled', 'surplus — no grade']) {
    assert.equal(offers(unknown).itemCondition, undefined, `condition=${String(unknown)}`)
  }
})
