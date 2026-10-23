/**
 * Ambient declarations for browser globals that are not part of the DOM lib.
 */

/** Google Analytics 4's data layer. */
declare global {
  interface Window {
    dataLayer: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

export {}
