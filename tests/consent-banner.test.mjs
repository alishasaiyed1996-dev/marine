/**
 * Regression tests for the prerendered cookie-consent banner.
 *
 * The React banner painted only after hydration plus a 2-second pacing timer,
 * which made `#cookie-consent-body` the mobile LCP element with ~3.3s of
 * elementRenderDelay. The fix ships the banner in the prerendered documents
 * (shared/consent-banner.mjs), makes it functional pre-hydration, and has
 * React remove the static node in the same commit it renders its own copy.
 *
 * These tests pin the pieces that must never drift apart:
 *  - the shared builder output matches the React component's markup/ids and
 *    the locale strings i18next serves
 *  - the pre-paint wiring script writes the same consent state as
 *    src/lib/consent.ts (localStorage key + mirror cookie)
 *  - the runtime strip stays cookie-aware and out of shared-cache responses
 *  - the prerenderer injects the block and stays idempotent
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const builder = await import('../shared/consent-banner.mjs')

const LOCALES = ['en', 'ar', 'es']

function localeStrings(locale) {
  return JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8')).cookieConsent
}

function source(file) {
  return readFileSync(file, 'utf8')
}

test('the static banner renders the same strings the React component shows', () => {
  for (const locale of LOCALES) {
    const html = builder.consentBannerMarkup(locale)
    const strings = localeStrings(locale)
    assert.ok(html.includes(builder.CONSENT_BANNER_START), `${locale}: has start marker`)
    assert.ok(html.includes(builder.CONSENT_BANNER_END), `${locale}: has end marker`)
    for (const key of ['title', 'body', 'privacyLink', 'accept', 'decline']) {
      assert.ok(
        html.includes(strings[key]),
        `${locale}: static banner contains cookieConsent.${key}`,
      )
    }
    assert.ok(
      html.includes(`href="/${locale}/privacy-policy/"`),
      `${locale}: privacy link points at the canonical locale page, as in CookieConsent.tsx`,
    )
  }
})

test('the static banner is the same dialog the React component renders', () => {
  const html = builder.consentBannerMarkup('en')
  for (const fragment of [
    `id="${builder.CONSENT_BANNER_ID}"`,
    'role="dialog"',
    'aria-modal="true"',
    'data-modal="consent"',
    'data-consent-accept',
    'data-consent-decline',
    // Same Tailwind classes as the React copy so the takeover repaints nothing.
    'px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:p-6 pointer-events-none',
    'max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-5 md:p-6',
  ]) {
    assert.ok(html.includes(fragment), `static banner contains ${fragment}`)
  }
  // aria-label is used instead of ids so the static copy can coexist with the
  // React copy (which owns cookie-consent-title/body) without duplicate ids.
  assert.ok(!html.includes('cookie-consent-title'), 'no duplicate aria ids')
  assert.ok(!html.includes('cookie-consent-body'), 'no duplicate aria ids')
})

test('the wiring script is functional before hydration', () => {
  const html = builder.consentBannerMarkup('en')
  const scriptMatch = html.match(/<script>\s*\(function \(\)[\s\S]*?<\/script>/)
  assert.ok(scriptMatch, 'the block carries its inline wiring script')
  const script = scriptMatch[0]
  assert.match(script, /alka-cookie-consent/, 'reads the same localStorage key as src/lib/consent.ts')
  assert.ok(script.includes(builder.CONSENT_COOKIE_NAME), 'writes the mirror consent cookie')
  assert.match(script, /path=\/; samesite=lax/, 'cookie is first-party scoped for the site path')
  assert.match(script, /alka:consent-change/, 'fires the same event the analytics gates listen for')
  assert.match(script, /el\.remove\(\)/, 'removes the node itself')
})

test('the mirror cookie stays in sync between the client and the pre-hydration script', () => {
  const consent = source('src/lib/consent.ts')
  assert.ok(consent.includes(builder.CONSENT_COOKIE_NAME), 'consent.ts declares the same cookie name')
  assert.match(
    consent,
    new RegExp(`CONSENT_COOKIE_MAX_AGE_SECONDS = ${builder.CONSENT_COOKIE_MAX_AGE_SECONDS}`),
    'consent.ts declares the same cookie lifetime',
  )
  assert.match(consent, /samesite=lax/, 'consent.ts writes a lax first-party cookie')
})

test('the lucide icons stay in sync with the icon package', () => {
  const cookieModule = source('node_modules/lucide-react/dist/esm/icons/cookie.mjs')
  const cookiePath = /d:\s*"([^"]+)"/g
  let match
  const builderHtml = builder.consentBannerMarkup('en')
  while ((match = cookiePath.exec(cookieModule))) {
    assert.ok(
      builderHtml.includes(`d="${match[1]}"`),
      `cookie icon path "${match[1]}" must be pinned in shared/consent-banner.mjs`,
    )
  }
  const xModule = source('node_modules/lucide-react/dist/esm/icons/x.mjs')
  const xPath = /d:\s*"([^"]+)"/g
  while ((match = xPath.exec(xModule))) {
    assert.ok(
      builderHtml.includes(`d="${match[1]}"`),
      `x icon path "${match[1]}" must be pinned in shared/consent-banner.mjs`,
    )
  }
})

test('stripStaticConsentBlock removes the whole block including its script', () => {
  const page = [
    '<!doctype html><html lang="en"><body>',
    '<main>content</main>',
    builder.consentBannerMarkup('en'),
    '</body></html>',
  ].join('\n')
  const stripped = builder.stripStaticConsentBlock(page)
  assert.ok(!stripped.includes(builder.CONSENT_BANNER_START), 'start marker removed')
  assert.ok(!stripped.includes(builder.CONSENT_BANNER_END), 'end marker removed')
  assert.ok(!stripped.includes('data-consent-accept'), 'accept button removed with the block')
  assert.ok(!/<script>\s*\(function \(\)/.test(stripped), 'wiring script removed with the block')
  assert.ok(stripped.includes('<main>content</main>'), 'the page around the block is untouched')
  assert.equal(builder.stripStaticConsentBlock(stripped), stripped, 'strip is idempotent')
})

test('stripStaticConsentBlock is a no-op for documents without the block', () => {
  const page = '<!doctype html><body><main>404</main></body></html>'
  assert.equal(builder.stripStaticConsentBlock(page), page, '404/stub documents are untouched')
})

test('the prerenderer strips then injects the block so repeated passes stay fresh', () => {
  const prerender = source('scripts/prerender.mjs')
  // Order matters: a "skip if present" guard would let pass N+1 inherit
  // pass N's English home block on every other locale — re-reading dist from
  // the previous run. Always strip, always inject.
  const stripIndex = prerender.indexOf('stripStaticConsentBlock(html)')
  const injectIndex = prerender.indexOf('consentBannerMarkup(locale)')
  assert.ok(stripIndex !== -1, 'prerender strips any existing block (e.g. from a previous pass)')
  assert.ok(injectIndex !== -1, 'prerender injects the shared localized builder output')
  assert.ok(stripIndex < injectIndex, 'the strip runs BEFORE the injection')
  assert.ok(!prerender.includes('hasStaticConsentBlock'), 'no skip-if-present guard remains in the prerenderer')
})

test('server.js strips the block only from responses that are not shared-cache candidates', () => {
  const server = source('server.js')
  assert.match(server, /consentCookieState\(/, 'the strip is driven by the mirror consent cookie')
  assert.match(server, /alka-consent/, 'server.js reads the same mirror cookie name')
  // Applied on the prerendered-document branches…
  assert.match(
    server,
    /stripStaticConsentForVisitor\(fs\.readFileSync\(prerendered, 'utf8'\), req\)/,
    'prerendered documents honor the visitor cookie',
  )
  assert.match(
    server,
    /html = stripStaticConsentForVisitor\(html, req\)/,
    'the renderDocument fallback inherits the strip policy',
  )
  // …and never on product/hub pages, which are served with a shared
  // `s-maxage` — a cookie variant must not enter a shared cache.
  const productSend = server.match(/productHtml\(template[\s\S]*?res\.locals\.cspNonce\)\)/)
  assert.ok(productSend, 'product render site found')
  assert.ok(!productSend[0].includes('stripStaticConsentForVisitor'), 'product render keeps the block (s-maxage)')
  const hubSend = server.match(/hubHtml\(template[\s\S]*?rendered\.html, res\.locals\.cspNonce\)\)/)
  assert.ok(!hubSend[0].includes('stripStaticConsentForVisitor'), 'hub render keeps the block (s-maxage)')
})

test('CookieConsent adopts the prerendered copy instead of repainting it', () => {
  const component = source('src/components/CookieConsent.tsx')
  assert.match(component, /const STATIC_ID = 'alka-consent-static'/, 'the component references the shared static id')
  assert.match(component, /getElementById\(STATIC_ID\)/, 'the component binds to the prerendered node')
  // Repainting while the prerendered copy exists creates a new equal-size LCP
  // candidate at mount, moving LCP from first paint to hydration time. React
  // may render only when the prerendered copy is absent.
  assert.match(component, /if \(mode !== 'react'\) return null/, "React renders only when there is no prerendered copy")
  const removals = component.match(/getElementById\(STATIC_ID\)\?\.remove\(\)/g) || []
  assert.equal(removals.length, 1, 'the static node is removed exactly once — in the consent listener')
  const binding = component.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[mode\]\)/)
  assert.ok(binding, 'the mount-time binding effect exists')
  assert.ok(!/\.remove\(\)\.?/.test(binding[0]), 'the mount effect must not remove the static node (that repaint steals LCP)')
  assert.match(component, /onConsentChange/, 'consent resolution anywhere closes the adopted copy')
  assert.match(component, /firstChild\.nodeValue/, 'language switches mirror into the adopted copy')
  assert.match(component, /useOverlayBehavior/, 'overlay behavior (scroll lock, Escape, focus trap) still applies')
  assert.ok(!component.includes('setTimeout'), 'no 2s visible pacing timer is left behind')
})
