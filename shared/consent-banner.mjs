/**
 * Shared cookie-consent banner markup — one source for the build-time
 * prerenderer and the runtime server.
 *
 * Problem this solves: the React banner painted only after hydration plus a
 * 2-second pacing timer, so on slow mobile loads `#cookie-consent-body` was
 * the Largest Contentful Paint element with ~3.3s of elementRenderDelay
 * (measured with Lighthouse 13.6 on the deployed build).
 *
 * Shape of the fix, in three layers:
 *  1. Build time   (`scripts/prerender.mjs`) injects `consentBannerMarkup()`
 *     before `</body>` of every prerendered document, so the banner paints
 *     with the first document paint. The markup is byte-for-byte the same
 *     structure/classes/text the React component renders, so the takeover
 *     is invisible.
 *  2. Pre-paint   The block's inline wiring script runs during parsing: for
 *     returning visitors (localStorage consent exists) it removes the static
 *     copy BEFORE first paint, so they never see a flash. For fresh visitors
 *     it wires the buttons so the banner is fully functional immediately —
 *     clicks write the same localStorage key, the mirror cookie, and fire the
 *     same `alka:consent-change` event the analytics gates listen for.
 *  3. Mount       `CookieConsent` removes the static node in a layout effect
 *     and hands over to the React copy in the same commit.
 *
 * Server-side, `stripStaticConsentBlock()` removes the whole block for
 * visitors whose mirror consent cookie is present, so repeat visitors stop
 * downloading the markup entirely. Markers wrap the block (markup + script)
 * with a range regex — never remove only part of it.
 *
 * Strings come from `src/locales/*.json` (`cookieConsent.*`), i.e. the exact
 * strings the React component shows, so each locale renders the same words
 * before and after hydration.
 */
import { readFileSync } from 'node:fs'

export const CONSENT_BANNER_ID = 'alka-consent-static'

/** First-party mirror cookie: `alka-consent=accepted|rejected`. Written by
 *  `src/lib/consent.ts` (post-hydration clicks) and by this module's inline
 *  script (pre-hydration clicks). Server-side strip reads it per request. */
export const CONSENT_COOKIE_NAME = 'alka-consent'

/** 180 days in seconds — long-lived on purpose: consent is not per-session. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 15552000

// These markers deliberately have no regex-significant characters, so the
// range replacement below stays simple. Keep them one-line and adjacent to
// the block they wrap.
export const CONSENT_BANNER_START = `<!-- ${CONSENT_BANNER_ID}:start -->`
export const CONSENT_BANNER_END = `<!-- ${CONSENT_BANNER_ID}:end -->`

const CONSENT_BANNER_BLOCK_RE = new RegExp(
  `${CONSENT_BANNER_START}[\\s\\S]*?${CONSENT_BANNER_END}\\s*`,
  'g',
)

export function hasStaticConsentBlock(html) {
  return html.includes(CONSENT_BANNER_START)
}

/**
 * Remove the whole static banner block (markup + wiring script) from a
 * prerendered/fallback document. Idempotent and a no-op when the page has no
 * block (server-rendered product/hub pages inherit the template with the
 * block, while 404 documents and legacy UUID redirect stubs have none).
 */
export function stripStaticConsentBlock(html) {
  return html.replace(CONSENT_BANNER_BLOCK_RE, '')
}

const BANNER_LOCALES = ['en', 'ar', 'es']

const messagesCache = new Map()

/** `cookieConsent.*` strings — the same single source the React component
 *  reads through i18next. Falls back to English for unknown locales. */
function consentMessages(locale) {
  const lang = BANNER_LOCALES.includes(locale) ? locale : 'en'
  if (!messagesCache.has(lang)) {
    const json = JSON.parse(
      readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'),
    )
    messagesCache.set(lang, json.cookieConsent)
  }
  return messagesCache.get(lang)
}

function escHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

// Inline copies of the lucide-react icons the React component renders
// (node_modules/lucide-react/dist/esm/icons/cookie.mjs and x.mjs). The static
// banner must look exactly like the React one — there is no module resolution
// inside server-rendered markup, so the SVG paths are pinned here. A test
// asserts they stay in sync with the icon package.
const LUCIDE_COOKIE_PATHS = [
  'M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5',
  'M8.5 8.5v.01',
  'M16 15.5v.01',
  'M12 12v.01',
  'M11 17v.01',
  'M7 14v.01',
]
const LUCIDE_X_PATHS = ['M18 6 6 18', 'm6 6 12 12']

function lucideSvg(size, extraClass, paths) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${extraClass}" aria-hidden="true">`
    + paths.map((d) => `<path d="${d}"/>`).join('')
    + '</svg>'
}

function buildBlock({ title, body, privacyLink, accept, decline }, locale) {
  // Trailing slash: the href lives in CRAWLABLE prerendered/service HTML, so
  // it must be the canonical URL directly (the seo-audit flags extensionless
  // internal links; the server would just redirect this href to the trailing
  // slash anyway). The React copy keeps its runtime href.
  const privacyHref = `/${locale}/privacy-policy/`
  return [
    CONSENT_BANNER_START,
    `<div id="${CONSENT_BANNER_ID}" class="fixed inset-0 z-[200] flex items-end md:items-center justify-center px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:p-6 pointer-events-none">`,
    // Same dialog semantics as the React copy. Uses aria-label + no ids: the
    // React copy keeps `cookie-consent-title`/`cookie-consent-body`, so both
    // copies can coexist in the DOM during the same-commit takeover without
    // ever producing duplicate ids.
    `  <div role="dialog" aria-modal="true" aria-label="${escHtml(title)}" data-modal="consent" class="pointer-events-auto mx-auto w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-5 md:p-6">`,
    `    <div class="flex flex-col md:flex-row md:items-center gap-4">`,
    `      <div class="flex items-start gap-3 flex-1">`,
    `        ${lucideSvg(24, 'lucide lucide-cookie text-[var(--accent-gold)] shrink-0 mt-0.5', LUCIDE_COOKIE_PATHS)}`,
    `        <div>`,
    `          <h3 class="text-sm font-bold text-[var(--text-primary)] mb-1">${escHtml(title)}</h3>`,
    `          <p class="text-xs text-[var(--text-secondary)] leading-relaxed">${escHtml(body)} <a href="${privacyHref}" class="text-[var(--accent-blue)] hover:underline">${escHtml(privacyLink)}</a></p>`,
    `        </div>`,
    `      </div>`,
    `      <div class="flex flex-wrap items-center gap-2 shrink-0">`,
    `        <button type="button" data-consent-decline class="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer">${escHtml(decline)}</button>`,
    `        <button type="button" data-consent-accept class="rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors cursor-pointer">${escHtml(accept)}</button>`,
    `        <button type="button" data-consent-decline aria-label="${escHtml(decline)}" class="tap-native tap-pad flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] md:hidden cursor-pointer">${lucideSvg(16, 'lucide lucide-x', LUCIDE_X_PATHS)}</button>`,
    `      </div>`,
    `    </div>`,
    `  </div>`,
    // Inline wiring script. Runs during parsing (before React's deferred
    // module): removes the block pre-paint for visitors with consent on
    // record, and makes the Accept/Decline buttons functional immediately.
    // The engine that guards the real tags (index.html) reads the same
    // localStorage key and listens for the same custom event, so a click
    // here activates analytics without waiting for React.
    `  <script>`,
    `    (function () {`,
    `      var el = document.getElementById('${CONSENT_BANNER_ID}')`,
    `      if (!el) return`,
    `      var saved = null`,
    `      try {`,
    `        var raw = window.localStorage.getItem('alka-cookie-consent')`,
    `        if (raw) saved = JSON.parse(raw)`,
    `      } catch (e) {}`,
    `      if (saved && typeof saved.accepted === 'boolean') {`,
    `        el.remove()`,
    `        return`,
    `      }`,
    `      function decide(accepted) {`,
    `        try {`,
    `          window.localStorage.setItem('alka-cookie-consent', JSON.stringify({ accepted: accepted, timestamp: Date.now() }))`,
    `        } catch (e) {}`,
    `        try {`,
    `          document.cookie = '${CONSENT_COOKIE_NAME}=' + (accepted ? 'accepted' : 'rejected') + '; max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; path=/; samesite=lax'`,
    `        } catch (e) {}`,
    `        el.remove()`,
    `        window.dispatchEvent(new CustomEvent('alka:consent-change', { detail: { accepted: accepted } }))`,
    `      }`,
    `      el.querySelectorAll('[data-consent-accept], [data-consent-decline]').forEach(function (button) {`,
    `        button.addEventListener('click', function () {`,
    `          decide(button.hasAttribute('data-consent-accept'))`,
    `        })`,
    `      })`,
    `    })()`,
    `  </script>`,
    CONSENT_BANNER_END,
    '',
  ].join('\n')
}

/** Localized static banner block (markers + markup + wiring script). */
export function consentBannerMarkup(locale = 'en') {
  const lang = BANNER_LOCALES.includes(locale) ? locale : 'en'
  return buildBlock(consentMessages(lang), lang)
}
