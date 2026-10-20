import { createContext, useContext } from 'react'

export interface PayPalAvailability {
  /** True when the backend has a real client ID and the provider is mounted. */
  configured: boolean
  /** True while the client ID or the PayPal SDK script is still loading. */
  loading: boolean
}

/**
 * Safe alternative to `usePayPalScriptReducer()` for components that can
 * render before the provider mounts (or when PayPal is not configured at all).
 * Calling the PayPal hook without a provider throws and takes checkout down.
 */
export const PayPalAvailabilityContext = createContext<PayPalAvailability>({
  configured: false,
  loading: true,
})

export const usePayPalAvailability = () => useContext(PayPalAvailabilityContext)
