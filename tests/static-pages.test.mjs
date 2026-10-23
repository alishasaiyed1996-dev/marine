import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STATIC_PAGE_META,
  STATIC_PAGE_SLUGS,
} from '../shared/static-pages.mjs'
import { LOCALIZED_PAGE_META } from '../shared/static-pages-i18n.mjs'
import { getStaticRoutes } from '../scripts/prerender-routes.mjs'

/**
 * Guards the "one page metadata" rule (S-4/D-8).
 *
 * `server.js`, the prerenderer and the React SEO layer all read
 * `shared/static-pages.mjs` (and its localization). These tests fail if a route
 * is described only in one of those layers, or if the copies drift again.
 */

const routes = getStaticRoutes()

test('every prerendered static route resolves its metadata from the shared manifest', () => {
  for (const route of routes) {
    const expected = STATIC_PAGE_META[route.slug]
    assert.ok(expected, `no shared metadata for slug "${route.slug}"`)
    assert.ok(route.title.length > 0, `empty title for ${route.path}`)
    assert.ok(route.description.length > 0, `empty description for ${route.path}`)
    assert.ok(route.h1.length > 0, `empty h1 for ${route.path}`)
  }
})

test('the English prerendered HTML uses the manifest title, description and h1 verbatim', () => {
  for (const route of routes) {
    if (route.locale !== 'en') continue
    const expected = STATIC_PAGE_META[route.slug]
    assert.equal(route.title, expected.title, `title drift on ${route.path}`)
    assert.equal(route.description, expected.description, `description drift on ${route.path}`)
    assert.equal(route.h1, expected.h1, `h1 drift on ${route.path}`)
  }
})

test('every manifest slug is prerendered for every shipped locale', () => {
  const prerendered = new Set(routes.map((route) => route.slug))
  for (const slug of STATIC_PAGE_SLUGS) {
    assert.ok(prerendered.has(slug), `"${slug}" is in the manifest but never prerendered`)
  }
  assert.equal(routes.length, STATIC_PAGE_SLUGS.length * 3, 'expected 13 routes × 3 locales')
})

test('Arabic and Spanish carry translated metadata for every manifest slug', () => {
  for (const locale of ['ar', 'es']) {
    const table = LOCALIZED_PAGE_META[locale]
    assert.ok(table, `missing ${locale} metadata`)
    assert.deepEqual(
      Object.keys(table).sort(),
      [...STATIC_PAGE_SLUGS].sort(),
      `${locale} metadata must cover exactly the manifest slugs`,
    )
    for (const slug of STATIC_PAGE_SLUGS) {
      const localized = table[slug]
      const english = STATIC_PAGE_META[slug]
      assert.ok(localized.title.length > 0, `${locale}/${slug || 'home'} has no title`)
      assert.ok(localized.description.length > 0, `${locale}/${slug || 'home'} has no description`)
      assert.ok(localized.h1.length > 0, `${locale}/${slug || 'home'} has no h1`)
      assert.notEqual(
        localized.title,
        english.title,
        `${locale}/${slug || 'home'} title is not translated`,
      )
    }
  }
})

test('titles are unique and descriptions are meta-length', () => {
  const seen = new Map()
  for (const [slug, meta] of Object.entries(STATIC_PAGE_META)) {
    const previous = seen.get(meta.title)
    assert.equal(previous, undefined, `"${slug}" reuses the title of "${previous}"`)
    seen.set(meta.title, slug)
    assert.ok(
      meta.description.length >= 50 && meta.description.length <= 320,
      `"${slug || 'home'}" description is ${meta.description.length} characters`,
    )
  }
})
