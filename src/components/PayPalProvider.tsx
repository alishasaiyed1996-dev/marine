import { PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js'
import { type ReactNode, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { storefront } from '../lib/api/storefront'
import { PayPalAvailabilityContext } from '../hooks/usePayPalAvailability'

/**
 * Routes whose UI actually renders PayPal buttons. The PayPal SDK is a large
 * third-party script that used to download on EVERY page (home, catalog, even
 * the admin panel) just because the provider sat at the app root — it competed
 * with page content for bandwidth and main-thread time, which read as a slow
 * site. The availability context still reports the configured state everywhere,
 * so checkout keeps its no-flicker behaviour when the route activates.
 */
const PAYPAL_ROUTE = /\/(?:checkout|account\/offers\/[^/]+\/pay)\/?$/

/** Reads the SDK loading state from inside the provider and publishes it. */
function PayPalScriptStatus({ children }: { children: ReactNode }) {
  const [{ isPending }] = usePayPalScriptReducer()
  return (
    <PayPalAvailabilityContext.Provider value={{ configured: true, loading: Boolean(isPending) }}>
      {children}
    </PayPalAvailabilityContext.Provider>
  )
}

/**
 * Wraps the app with PayPalScriptProvider.
 * Fetches the client ID from the backend (through API_BASE, so it works from
 * any host) and initializes the SDK with the real sandbox / live credentials.
 *
 * No demo fallbacks: if the backend can't be reached or PayPal isn't
 * configured, the SDK is simply not loaded and PayPal buttons render as
 * unavailable — the rest of the app keeps working.
 */
export function PayPalProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [clientId, setClientId] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    storefront.payments
      .clientId()
      .then((data) => {
        if (cancelled) return
        const id = data.clientId
        // A placeholder or sandbox value means PayPal isn't configured on the
        // backend yet — render without PayPal rather than with a fake ID.
        if (!id || id.includes('YOUR_') || id === 'sandbox' || id === 'test') {
          setClientId(null)
          return
        }
        setCurrency(String(data.currency || 'USD').toUpperCase())
        setClientId(id)
      })
      .catch(() => {
        // Backend unreachable → no PayPal. Never fall back to a demo ID.
        if (!cancelled) setClientId(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // While the client ID is being fetched, keep the app mounted but expose the
  // loading state so checkout can wait instead of calling a provider-less hook.
  if (loading) {
    return (
      <PayPalAvailabilityContext.Provider value={{ configured: false, loading: true }}>
        {children}
      </PayPalAvailabilityContext.Provider>
    )
  }

  // If PayPal isn't configured or errored, render children without the provider
  // so the rest of the app still works.
  if (!clientId) {
    return (
      <PayPalAvailabilityContext.Provider value={{ configured: false, loading: false }}>
        {children}
      </PayPalAvailabilityContext.Provider>
    )
  }

  // Off the PayPal routes: keep the availability context (checkout reads it to
  // stay flicker-free), but do NOT mount the script provider — the SDK only
  // downloads on pages that actually render PayPal buttons.
  if (!PAYPAL_ROUTE.test(location.pathname)) {
    return (
      <PayPalAvailabilityContext.Provider value={{ configured: true, loading: false }}>
        {children}
      </PayPalAvailabilityContext.Provider>
    )
  }

  return (
    <PayPalScriptProvider
      options={{
        clientId,
        currency,
        intent: 'capture',
        // PayPal only (2026-10-28 decision): the store accepts PayPal as its
        // single payment method, so the checkout renders exactly ONE branded
        // button. No extra funding sources are enabled — the US-only wallet
        // and the separate card button were both removed. Card payment inside
        // the PayPal popup (guest wallet) is unaffected; it settles through
        // PayPal.
        components: 'buttons',
      }}
    >
      <PayPalScriptStatus>{children}</PayPalScriptStatus>
    </PayPalScriptProvider>
  )
}
