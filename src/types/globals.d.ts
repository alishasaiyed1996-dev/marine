/**
 * Ambient declarations for browser globals that are not part of the DOM lib.
 */

/** Google Analytics 4's data layer. */
declare global {
  interface Window {
    dataLayer: unknown[]
    gtag?: (...args: unknown[]) => void
    /** GA4 measurement ID of the tag hardcoded in index.html, when present. */
    __alkaStaticGaId?: string
    /** Activates the hardcoded tag once consent allows it (see index.html). */
    __alkaActivateGa?: () => void
    /** Set once the hardcoded tag has been activated. */
    __alkaGaActive?: boolean
    /** Activates Google Tag Manager after analytics consent (see index.html). */
    __alkaActivateGtm?: () => void
    /** Set once the Google Tag Manager container has been activated. */
    __alkaGtmActive?: boolean
    /** Activates Microsoft Clarity after analytics consent (see index.html). */
    __alkaActivateClarity?: () => void
    /** Set once the Clarity tag has been activated. */
    __alkaClarityActive?: boolean
  }
}

export {}
