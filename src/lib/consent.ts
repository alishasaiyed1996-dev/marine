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

/**
 * First-party mirror cookie (`alka-consent=accepted|rejected`) written on
 * every consent answer. server.js reads it per request to send prerendered
 * documents WITHOUT the static banner block (the React banner then stays
 * hidden by consent, so the markup is redundant per visit). Lifetime/values
 * must stay in sync with shared/consent-banner.mjs, which writes the same
 * cookie in the pre-hydration wiring script — tests/consent-banner.test.mjs
 * pins the two in sync.
 */
export const CONSENT_COOKIE_NAME = 'alka-consent'
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 15552000 // 180 days

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
  // The mirror cookie is written independently of localStorage availability:
  // whenever the answer is recorded anywhere, the server should remember it.
  // If the cookie write fails, the server keeps sending the static block and
  // the inline cleanup script removes it pre-paint instead (no flash either way).
  try {
    window.document.cookie = `${CONSENT_COOKIE_NAME}=${accepted ? 'accepted' : 'rejected'}; max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; path=/; samesite=lax`
  } catch {
    /* cookie write unavailable — the cleanup script covers the client side */
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
