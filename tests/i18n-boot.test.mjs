/**
 * Regression tests for the i18n boot locale.
 *
 * `i18next` was initialized with a hardcoded `lng: 'en'`, so every non-English
 * page mounted with English strings and re-rendered all visible text when
 * `LocaleLayout`'s locale effect fired — on /ar/ that repaints the document
 * (and the prerendered consent banner mirror) Latin-for-Arabic between two
 * paints: readers see a language flash and Lighthouse counts a layout shift.
 * The boot language must be the URL locale that matches the already-set
 * <html lang/dir>.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(file) {
  return readFileSync(file, 'utf8')
}

test('i18n boots in the served locale, not a hardcoded language', () => {
  const main = source('src/main.tsx')
  assert.match(
    main,
    /const pathLocale = window\.location\.pathname\.split\('\/'\)\[1\]/,
    'the initial locale is read from the URL path',
  )
  assert.match(
    main,
    /lng: initialLocale/,
    'i18next initializes with the URL locale (was hardcoded lng: \'en\')',
  )
  assert.doesNotMatch(
    main,
    /lng:\s*'en'/,
    'no hardcoded English boot language is left behind',
  )
})

test('the boot locale covers the served locale set and falls back sanely', () => {
  const main = source('src/main.tsx')
  // The whitelist must include every locale the server prerenders.
  for (const locale of ['ar', 'es', 'en']) {
    assert.ok(
      new RegExp(`'${locale}'`).test(main),
      `main.tsx references '${locale}'`,
    )
  }
  // Navigator detection + 'en' fallback must stay, mirroring the setLanguage
  // contract in src/store/useStore.ts.
  assert.match(
    main,
    /navigator\.language\?\.startsWith\('ar'\) \? 'ar' : navigator\.language\?\.startsWith\('es'\) \? 'es' : 'en'/,
    'non-URL visitors keep the navigator-based fallback',
  )
  // The fallback lives in the same expression the store's setLanguage uses.
  const store = source('src/store/useStore.ts')
  assert.match(store, /setLanguage: \(language\) =>\s*\{[\s\S]*?i18n\.changeLanguage\(language\)/,
    'runtime language switching still flows through i18n.changeLanguage')
})

test('<html lang/dir are still applied before React mounts', () => {
  const main = source('src/main.tsx')
  const htmlLangIndex = main.indexOf('document.documentElement.lang = initialLocale')
  const initIndex = main.indexOf('i18n.use(initReactI18next).init')
  const renderIndex = main.indexOf('createRoot(document.getElementById(\'root\')!)')
  assert.ok(htmlLangIndex > -1 && initIndex > -1 && renderIndex > -1)
  assert.ok(htmlLangIndex < initIndex, 'lang/dir are set before i18n init')
  assert.ok(initIndex < renderIndex, 'i18n is initialized before the first render')
})
