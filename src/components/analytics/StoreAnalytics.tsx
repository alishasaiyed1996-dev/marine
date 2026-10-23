import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { getCspNonce } from '../../lib/csp'
import { hasAnalyticsConsent, onConsentChange } from '../../lib/consent'
import { trackPageView } from '../../lib/analytics'

/**
 * Injects the Google Analytics 4 tag — but only with consent.
 *
 * Before, the tag loaded whenever a GA id was configured and never read the
 * consent key, so "Decline" in the cookie banner changed nothing while the
 * privacy policy described remarketing. The banner and the privacy policy
 * have to agree; the way to make them agree is to honour the choice.
 *
 * The tag is also excluded from the password-reset route: its URL carries a
 * one-time token, and `page_location` would send it to Google.
 */
export function StoreAnalytics() {
  const { googleAnalyticsId } = useStoreSettings()
  const location = useLocation()

  useEffect(() => {
    const id = googleAnalyticsId?.trim()
    if (!id) return

    const SCRIPT_ID = 'alka-ga4-script'
    const INIT_ID = 'alka-ga4-init'

    const removeTag = () => {
      document.getElementById(SCRIPT_ID)?.remove()
      document.getElementById(INIT_ID)?.remove()
      // Stop the tag from sending anything further.
      window.dataLayer = []
    }

    const isExcludedPath = () => /^\/(en\/|ar\/|es\/)?reset-password/i.test(location.pathname)

    const loadTag = () => {
      if (!hasAnalyticsConsent()) return
      if (isExcludedPath()) return
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
        `gtag('js',new Date());gtag('config','${id}',{send_page_view:false});`
      document.head.appendChild(init)
    }

    loadTag()

    // React to a consent decision taken while the page is open.
    const unsubscribe = onConsentChange((accepted) => {
      if (accepted) loadTag()
      else removeTag()
    })

    return () => {
      unsubscribe()
      removeTag()
    }
  }, [googleAnalyticsId, location.pathname])

  // SPA page views. Without this the analytics property only ever saw the
  // first page of a session — the storefront is a client-rendered app, so
  // navigation never triggered a document load.
  useEffect(() => {
    if (!googleAnalyticsId?.trim()) return
    if (/^\/(en\/|ar\/|es\/)?reset-password/i.test(location.pathname)) return
    if (!hasAnalyticsConsent()) return
    // The tag is configured with `send_page_view: false`, so the SPA is
    // responsible for every page view.
    trackPageView(location.pathname + location.search, document.title)
  }, [googleAnalyticsId, location.pathname, location.search])

  return null
}
