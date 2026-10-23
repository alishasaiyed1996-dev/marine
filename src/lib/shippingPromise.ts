import { formatMoney } from './utils'
import type { ShippingZone } from './shipping'

/**
 * The customer-facing shipping promise.
 *
 * The free-shipping threshold is not a single number: when the admin has
 * configured shipping zones, each zone has its own rate and its own free
 * threshold, and the zone rule is authoritative (see
 * `backend/src/utils/shipping.ts`). A static "Free shipping above $100" in the
 * top bar therefore contradicts the checkout whenever zones are configured.
 *
 * This helper derives the promise from the same configuration the server uses:
 *   - zones configured  → "Shipping calculated at checkout" (no false promise)
 *   - no zones          → "Free shipping above <threshold>"
 */
export interface ShippingPromiseInput {
  zones: ShippingZone[]
  freeShippingThreshold: number
  currency: string
}

export interface ShippingPromise {
  /** The short headline for the top bar. */
  label: string
  /** The secondary line, when the layout shows one. */
  sub?: string
  /** True when a concrete free-shipping threshold applies. */
  hasThreshold: boolean
  threshold: number
  currency: string
}

/**
 * Builds the shipping promise for the storefront. `t` is the i18n translate
 * function; the keys must exist in every locale bundle.
 */
export function buildShippingPromise(
  input: ShippingPromiseInput,
  t: (key: string, options?: Record<string, unknown>) => string,
): ShippingPromise {
  const activeZones = (input.zones || []).filter((zone) => zone.active !== false)
  const threshold = Number(input.freeShippingThreshold) || 0

  if (activeZones.length > 0) {
    // Zone rates and thresholds vary by destination — promise nothing the
    // checkout will not honour.
    return {
      label: t('topbar.shippingCalculated'),
      sub: t('topbar.shippingCalculatedSub'),
      hasThreshold: false,
      threshold: 0,
      currency: input.currency,
    }
  }

  if (threshold > 0) {
    const amount = formatMoney(threshold, input.currency)
    return {
      label: t('topbar.freeShippingThreshold', { amount }),
      sub: t('topbar.freeShippingSub', { amount }),
      hasThreshold: true,
      threshold,
      currency: input.currency,
    }
  }

  return {
    label: t('topbar.shippingCalculated'),
    sub: t('topbar.shippingCalculatedSub'),
    hasThreshold: false,
    threshold: 0,
    currency: input.currency,
  }
}

/**
 * The shipping terms shown on the Terms page.
 *
 * The previous copy promised "$15 freight below $100, free above $100" while
 * the server priced $25 flat with per-zone rates — the legal page and the
 * invoice disagreed. These bullets are generated from the same configuration
 * the checkout uses.
 */
export function buildShippingTerms(input: {
  zones: ShippingZone[]
  baseShippingCost: number
  freeShippingThreshold: number
  currency: string
}): string[] {
  const activeZones = (input.zones || []).filter((zone) => zone.active !== false)
  const money = (value: number) => formatMoney(value, input.currency)

  if (activeZones.length > 0) {
    const lines = activeZones.map((zone) => {
      const threshold = Number(zone.freeThreshold) || 0
      const rate = zone.rateType === 'free'
        ? 'free of freight'
        : `${money(Number(zone.flatRate) || 0)} freight`
      const thresholdPart = threshold > 0
        ? ` (free above ${money(threshold)})`
        : ''
      return `${zone.name}: ${rate}${thresholdPart}`
    })
    return [
      'Shipping is charged by destination zone. The rate for your destination is confirmed at checkout.',
      ...lines,
    ]
  }

  const threshold = Number(input.freeShippingThreshold) || 0
  if (threshold > 0) {
    return [
      `Orders below ${money(threshold)} are charged a flat ${money(input.baseShippingCost)} freight.`,
      `Orders at or above ${money(threshold)} are shipped free of freight, subject to the weight limits below.`,
    ]
  }

  return [`A flat freight of ${money(input.baseShippingCost)} applies to every order.`]
}
