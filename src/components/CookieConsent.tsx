import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cookie, X } from 'lucide-react'
import { writeConsent, readConsent } from '../lib/consent'
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
 * Prerendered takeover (perf): the build prerenders this exact markup before
 * `</body>` (shared/consent-banner.mjs), so the banner paints with the first
 * document paint instead of after hydration — it used to be the mobile LCP
 * element with ~3.3s of elementRenderDelay. This component renders its own
 * copy immediately on mount (the old 2s pacing timer is gone) and removes the
 * static node in the same commit, before paint. The wiring script inside the
 * static block covers clicks during the pre-hydration window, so the banner
 * is never inert.
 */
export function CookieConsent() {
  const { t, i18n } = useTranslation()
  const locale = ['en', 'ar', 'es'].includes(i18n.language) ? i18n.language : 'en'
  // Lazy initial read: the banner is visible from the very first render when
  // no consent exists, mirroring the prerendered copy 1:1 in the same mount
  // commit — no flash, no layout shift between the static and React copies.
  const [visible, setVisible] = useState(() => !readConsent())
  const dialogRef = useRef<HTMLDivElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)

  // BEFORE paint: this commit renders the React copy and removes the
  // prerendered node, so the browser paints a single banner. Runs
  // unconditionally (also when `visible` is false, i.e. consent already
  // recorded) so returning visitors never keep a non-React copy in the DOM.
  useLayoutEffect(() => {
    document.getElementById('alka-consent-static')?.remove()
  }, [])

  // Declared before the focus effect: Escape calls `decline`, and referencing
  // it before its declaration made the effect capture a stale binding.
  const accept = useCallback(() => {
    writeConsent(true)
    setVisible(false)
  }, [])

  const decline = useCallback(() => {
    writeConsent(false)
    setVisible(false)
  }, [])

  // Shared overlay behavior: scroll lock, Escape, focus trap, focus move
  // (to Accept) + restore — same primitive the cart drawer and modals use.
  useOverlayBehavior({
    open: visible,
    onClose: decline,
    panelRef: dialogRef,
    initialFocusRef: acceptRef,
    lockKey: 'consent',
  })

  if (!visible) return null

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
