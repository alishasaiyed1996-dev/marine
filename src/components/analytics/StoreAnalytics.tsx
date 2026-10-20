import { useEffect } from 'react'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { getCspNonce } from '../../lib/csp'

/**
 * Injects the Google Analytics 4 tag when the admin has configured
 * Settings → Site Config → Google Analytics ID (site.googleAnalyticsId).
 * Renders nothing; mounted on the storefront only.
 */
export function StoreAnalytics() {
  const { googleAnalyticsId } = useStoreSettings()

  useEffect(() => {
    const id = googleAnalyticsId?.trim()
    if (!id) return

    const SCRIPT_ID = 'alka-ga4-script'
    const INIT_ID = 'alka-ga4-init'
    if (document.getElementById(SCRIPT_ID)) return

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
    document.head.appendChild(script)

    const init = document.createElement('script')
    init.id = INIT_ID
    // The page CSP uses a per-response nonce; dynamically created inline
    // scripts must carry it or the browser blocks the GA config.
    const nonce = getCspNonce()
    if (nonce) init.nonce = nonce
    init.textContent =
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());gtag('config','${id}');`
    document.head.appendChild(init)

    return () => {
      document.getElementById(SCRIPT_ID)?.remove()
      document.getElementById(INIT_ID)?.remove()
    }
  }, [googleAnalyticsId])

  return null
}
