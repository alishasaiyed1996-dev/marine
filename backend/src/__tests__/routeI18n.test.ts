/**
 * Contract test: the backend's copy of the translated-route list must match
 * the canonical one in shared/route-i18n.mjs.
 *
 * The backend API is deployed from `backend/` only and therefore cannot import
 * the shared module at runtime. This test is what stops the two lists from
 * drifting: a sitemap entry for an Arabic URL that the storefront refuses to
 * index is exactly the "half-indexed language layer" the audit flagged.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SHIPPED_LOCALES as BACKEND_LOCALES,
  TRANSLATED_ROUTES as BACKEND_ROUTES,
  hasTranslatedRoute as backendHasTranslatedRoute,
  toRoutePath as backendToRoutePath,
} from '../utils/routeI18n.js'
import {
  SHIPPED_LOCALES as SHARED_LOCALES,
  TRANSLATED_ROUTES as SHARED_ROUTES,
  hasTranslatedRoute as sharedHasTranslatedRoute,
  toRoutePath as sharedToRoutePath,
} from '../../../shared/route-i18n.mjs'

test('the shipped locale list is identical in the backend and the shared module', () => {
  assert.deepEqual([...BACKEND_LOCALES], [...SHARED_LOCALES])
})

test('the translated route list is identical in the backend and the shared module', () => {
  assert.deepEqual([...BACKEND_ROUTES], [...SHARED_ROUTES])
})

test('route normalization matches', () => {
  const samples = ['/', '/en', '/ar/', '/es/products', '/en/product/some-slug/', '/ar/brands/abb']
  for (const sample of samples) {
    assert.equal(backendToRoutePath(sample), sharedToRoutePath(sample), sample)
  }
})

test('translation lookup matches for every shipped locale and route', () => {
  for (const locale of BACKEND_LOCALES) {
    for (const route of BACKEND_ROUTES) {
      assert.equal(
        backendHasTranslatedRoute(route, locale),
        sharedHasTranslatedRoute(route, locale),
        `${locale} ${route}`,
      )
    }
  }
})
