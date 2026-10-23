/**
 * Cookie consent state.
 *
 * The consent banner said "We do not use third-party tracking cookies" while
 * the privacy policy described Google Analytics advertising features and
 * remarketing — and "Decline" changed nothing at all, because analytics
 * ignored the consent key entirely.
 *
 * This module is the single source of truth for whether analytics may run:
 *  - `hasAnalyticsConsent()` is the only gate the analytics loader checks.
 *  - The banner writes `accepted: true|false`; declining now genuinely stops
 *    the tag from loading.
 *  - The consent change is broadcast so an open page reacts immediately
 *    (accepting loads the tag, declining removes it).
 */

export const CONSENT_KEY = 'alka-cookie-consent'

export type ConsentState = {
  accepted: boolean
  timestamp: number
}

export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConsentState>
    if (typeof parsed?.accepted !== 'boolean') return null
    return { accepted: parsed.accepted, timestamp: Number(parsed.timestamp) || 0 }
  } catch {
    return null
  }
}

/**
 * Analytics consent.
 *
 * `null` means the visitor has not answered yet: analytics must NOT run
 * (no consent has been given). Returning `false` for "not answered" is what
 * makes the banner honest.
 */
export function hasAnalyticsConsent(): boolean {
  return readConsent()?.accepted === true
}

export function writeConsent(accepted: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted, timestamp: Date.now() }))
  } catch {
    /* storage unavailable — analytics stays off */
  }
  window.dispatchEvent(new CustomEvent('alka:consent-change', { detail: { accepted } }))
}

/** Subscribe to consent changes (returns an unsubscribe function). */
export function onConsentChange(handler: (accepted: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ accepted: boolean }>).detail
    handler(Boolean(detail?.accepted))
  }
  window.addEventListener('alka:consent-change', listener)
  return () => window.removeEventListener('alka:consent-change', listener)
}
