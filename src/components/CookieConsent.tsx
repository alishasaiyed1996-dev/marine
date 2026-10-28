import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cookie, X } from 'lucide-react'
import { writeConsent, readConsent, onConsentChange } from '../lib/consent'
import { useOverlayBehavior } from '../lib/overlay'

/**
 * Cookie consent banner.
 *
 * The old banner claimed "We do not use third-party tracking cookies" while
 * the privacy policy described Google Analytics advertising features and
 * remarketing — and "Decline" changed nothing, because analytics never read
 * the consent key. The copy now matches reality (analytics is used, and only
 * with consent) and the decline button genuinely stops it.
 *
 * It is a modal dialog: it traps focus, can be dismissed with Escape, and
 * does not steal focus from the page on first paint.
 *
 * Adopt, don't repaint (perf): the build prerenders this exact markup before
 * `</body>` (shared/consent-banner.mjs), so the banner paints with the first
 * document paint instead of after hydration — it used to be the mobile LCP
 * element with ~3.3s of elementRenderDelay. While that copy is present this
 * component renders NOTHING of its own: repainting identical markup fires a
 * new equal-size LCP candidate at mount, moving LCP from first paint to
 * hydration time (measured with Lighthouse on throttled loads: the LCP
 * element stayed `p#cookie-consent-body`, painted when React mounted).
 * Instead the component ADOPTS the prerendered node — refs bind to its
 * dialog/buttons so useOverlayBehavior (scroll lock, Escape, focus trap)
 * operates on it, Escape declines through the real consent path, and SPA
 * language switches are mirrored into its text. The block's wiring script
 * keeps it fully functional pre-hydration. The React copy below remains only
 * for documents without the block (cookie-stripped desync, dev server).
 */

/** The prerendered banner is wrapped in this id (shared/consent-banner.mjs). */
const STATIC_ID = 'alka-consent-static'

/** 'static' = the prerendered copy exists and owns the screen; 'react' = no
 *  prerendered copy, React renders the banner; 'none' = answered or absent. */
type BannerMode = 'static' | 'react' | 'none'

export function CookieConsent() {
  const { t, i18n } = useTranslation()
  const locale = ['en', 'ar', 'es'].includes(i18n.language) ? i18n.language : 'en'

  const [mode, setMode] = useState<BannerMode>(() => {
    if (typeof document === 'undefined') return 'none' // non-browser renders
    if (readConsent()) return 'none'
    return document.getElementById(STATIC_ID) ? 'static' : 'react'
  })
  const dialogRef = useRef<HTMLDivElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)

  // Mount: bind the shared overlay behavior onto the PRERENDERED nodes. The
  // node is never removed here — removal happens only after the visitor
  // answers (below). A mount-time swap would repaint the identical banner
  // under React and move LCP from first paint to hydration time.
  useLayoutEffect(() => {
    if (mode !== 'static') return
    const root = document.getElementById(STATIC_ID)
    if (!root) {
      // The node vanished before mount (its own script removed it because
      // consent was already on record): keep hiding, or fall back to the
      // React copy in the rare cookie/localStorage desync.
      setMode(readConsent() ? 'none' : 'react')
      return
    }
    dialogRef.current = root.querySelector<HTMLDivElement>('[role="dialog"]')
    acceptRef.current = root.querySelector<HTMLButtonElement>('[data-consent-accept]')
  }, [mode])

  // Any consent resolution (the prerendered wiring script, a banner click,
  // Escape here, the React copy, or the privacy-policy toggle) closes every
  // copy: sweep the static node (its wiring script already removed it on its
  // own clicks — this is needed for Escape and any React-side answer) and
  // release the overlay state so the scroll lock lifts and focus returns to
  // the page.
  useEffect(() => onConsentChange(() => {
    document.getElementById(STATIC_ID)?.remove()
  }), [])

  // i18n mirror for the adopted copy. Safe for LCP: switching the language
  // requires a click, which finalizes LCP before this effect can repaint.
  useEffect(() => {
    if (mode !== 'static') return
    const root = document.getElementById(STATIC_ID)
    if (!root) {
      setMode(readConsent() ? 'none' : 'react')
      return
    }
    const dialog = root.querySelector('[role="dialog"]')
    dialog?.setAttribute('aria-label', t('cookieConsent.title'))
    const heading = root.querySelector('h3')
    if (heading) heading.textContent = t('cookieConsent.title')
    const body = root.querySelector('p')
    if (body) {
      if (body.firstChild && body.firstChild.nodeType === Node.TEXT_NODE) {
        body.firstChild.nodeValue = `${t('cookieConsent.body')} `
      }
      const link = body.querySelector('a')
      if (link) {
        link.setAttribute('href', `/${locale}/privacy-policy/`)
        link.textContent = t('cookieConsent.privacyLink')
      }
    }
    const declineButtons = root.querySelectorAll<HTMLButtonElement>('[data-consent-decline]')
    const textDecline = declineButtons[0]
    const iconDecline = declineButtons[1]
    if (textDecline) textDecline.textContent = t('cookieConsent.decline')
    if (iconDecline) iconDecline.setAttribute('aria-label', t('cookieConsent.decline'))
    const acceptButton = root.querySelector('[data-consent-accept]')
    if (acceptButton) acceptButton.textContent = t('cookieConsent.accept')
  }, [mode, locale, t])

  // Declared before the focus effect: Escape calls `decline`, and referencing
  // it before its declaration made the effect capture a stale binding.
  // Handlers only write and broadcast — the consent listener above closes the
  // banner (both copies), so both paths share one exit.
  const accept = useCallback(() => {
    writeConsent(true)
  }, [])

  const decline = useCallback(() => {
    writeConsent(false)
  }, [])

  // Shared overlay behavior: scroll lock, Escape, focus trap, focus move
  // (to Accept) + restore — same primitive the cart drawer and modals use.
  // In static mode it operates on the prerendered nodes (refs bound above).
  useOverlayBehavior({
    open: mode !== 'none',
    onClose: decline,
    panelRef: dialogRef,
    initialFocusRef: acceptRef,
    lockKey: 'consent',
  })

  // The adopted prerendered copy IS the banner — React renders nothing beside
  // it (a repaint would steal LCP). 'none' means answered/absent → hidden.
  if (mode !== 'react') return null

  return (
    // The container spans the viewport but must not swallow clicks: only the
    // dialog itself is interactive. The previous fixed overlay covered the
    // whole page, including the WhatsApp button and the add-to-cart CTA.
    // Bottom padding includes the home-indicator inset so Accept/Decline
    // never sit in the gesture zone on notched phones.
    <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:p-6 pointer-events-none">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-consent-title"
        aria-describedby="cookie-consent-body"
        data-modal="consent"
        className="pointer-events-auto mx-auto w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-5 md:p-6"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Cookie size={24} className="text-[var(--accent-gold)] shrink-0 mt-0.5" />
            <div>
              <h3 id="cookie-consent-title" className="text-sm font-bold text-[var(--text-primary)] mb-1">
                {t('cookieConsent.title')}
              </h3>
              <p id="cookie-consent-body" className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {t('cookieConsent.body')}{' '}
                <a href={`/${locale}/privacy-policy`} className="text-[var(--accent-blue)] hover:underline">
                  {t('cookieConsent.privacyLink')}
                </a>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={decline}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
            >
              {t('cookieConsent.decline')}
            </button>
            <button
              ref={acceptRef}
              type="button"
              onClick={accept}
              className="rounded-xl bg-[var(--accent-gold)] px-4 py-2.5 text-xs font-extrabold text-[var(--btn-blue-text)] hover:brightness-95 transition-colors cursor-pointer"
            >
              {t('cookieConsent.accept')}
            </button>
            <button
              type="button"
              onClick={decline}
              aria-label={t('cookieConsent.decline')}
              className="tap-native tap-pad flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] md:hidden cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
