/**
 * CSP nonce access.
 *
 * The Express server sends a per-response nonce in the CSP header and mirrors
 * it into <meta name="csp-nonce">. Inline scripts it generates (prerendered
 * JSON-LD, the Vite theme bootstrap) get the attribute server-side; scripts
 * React creates after hydration must copy it or the browser blocks them.
 *
 * The meta tag is parsed before the app bundle runs, so a plain read is safe.
 * A missing value (e.g. local `vite dev`, which does not set a CSP header)
 * simply renders the attribute as absent.
 */
export function getCspNonce(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const meta = document.querySelector('meta[name="csp-nonce"]')
  return meta?.getAttribute('content') || undefined
}
