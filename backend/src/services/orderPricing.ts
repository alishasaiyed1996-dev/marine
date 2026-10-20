import { prisma } from '../server.js'
import { numberOrDefault } from '../utils/helpers.js'
import { calcShippingCost, parseShippingZones } from '../utils/shipping.js'

export interface OrderTotals {
  subtotal: number
  shippingCost: number
  tax: number
  total: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Server-authoritative order totals. Every order-creation path (storefront
 * checkout, accepted-offer PayPal checkout, admin offer/RFQ conversion) must
 * price shipping, tax, and the grand total the same way so the same basket
 * cannot cost different amounts depending on which flow created the order.
 *
 * The client never supplies these values; only the subtotal (from stored
 * line prices) and the destination country are inputs here.
 */
export async function computeOrderTotals(subtotal: number, country: string | null | undefined): Promise<OrderTotals> {
  const [shippingCostSetting, taxRateSetting, freeShippingThresholdSetting, shippingZonesSetting] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { key: 'checkout.shippingCost' } }),
    prisma.storeSetting.findUnique({ where: { key: 'checkout.taxRate' } }),
    prisma.storeSetting.findUnique({ where: { key: 'checkout.freeShippingThreshold' } }),
    prisma.storeSetting.findUnique({ where: { key: 'store.shippingZones' } }),
  ])

  const baseShippingCost = numberOrDefault(
    shippingCostSetting?.value,
    numberOrDefault(process.env.DEFAULT_SHIPPING_COST, 25),
  )
  const freeShippingThreshold = numberOrDefault(freeShippingThresholdSetting?.value, 100)
  const shippingCost = calcShippingCost({
    subtotal,
    country: country || '',
    zones: parseShippingZones(shippingZonesSetting?.value),
    baseShippingCost,
    freeShippingThreshold,
  })
  const taxRate = numberOrDefault(
    taxRateSetting?.value,
    numberOrDefault(process.env.DEFAULT_TAX_RATE, 0.08),
  )

  const roundedSubtotal = round2(subtotal)
  const tax = round2(roundedSubtotal * taxRate)
  return {
    subtotal: roundedSubtotal,
    shippingCost: round2(shippingCost),
    tax,
    total: round2(roundedSubtotal + shippingCost + tax),
  }
}
