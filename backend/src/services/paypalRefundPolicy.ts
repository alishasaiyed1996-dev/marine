/**
 * Pure decision rules for PAYMENT.CAPTURE.REFUNDED webhooks (audit B10).
 *
 * PayPal can refund through its own side without this store reading about it
 * until the webhook lands: a seller refund from the PayPal dashboard, a
 * dispute resolution, or a buyer self-service reversal. When the money left,
 * payment state must also change here — otherwise stock stays claimed for
 * units that were returned to the buyer and the admin sees "paid" while the
 * buyer has their money back.
 *
 * No prisma / no PayPal SDK — pure module per house convention
 * ("bankDetails.test.ts rule": unit tests must not import DB/server code).
 *
 * Semantics mirror orderMutations.restoreStockAndRefund: only a FULL refund
 * moves payment state. A partial refund is an admin business decision; the
 * webhook then only leaves a timeline note.
 */

export type RefundKind = 'full' | 'partial' | 'unidentifiable'

export interface RefundClassification {
  kind: RefundKind
  /** Refund amount as parsed from the notification; null when unparseable. */
  amount: number | null
  /** The order total the amount was compared against. */
  orderTotal: number | null
}

/** Float noise: a refund within one cent of the order total is full. */
const FULL_REFUND_EPSILON = 0.01

interface RefundAmount {
  value?: unknown
  currency_code?: unknown
}

function parseAmountValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function classifyCaptureRefund(
  resource: unknown,
  order: { total: number; currency?: string | null },
): RefundClassification {
  const amount = ((resource as { amount?: RefundAmount } | null | undefined)?.amount ?? null) as RefundAmount | null
  const refundValue = parseAmountValue(amount?.value)
  const orderTotal = order.total

  if (refundValue === null || !Number.isFinite(orderTotal)) {
    return { kind: 'unidentifiable', amount: refundValue, orderTotal }
  }

  // A real PAYMENT.CAPTURE.REFUNDED carries the capture currency, which is the
  // order currency. A currency mismatch means the payload cannot be reconciled
  // to this order's money — never act on it.
  const refundCurrency = typeof amount?.currency_code === 'string' && amount.currency_code.trim()
    ? amount.currency_code.trim().toUpperCase()
    : null
  const orderCurrency = order.currency ? String(order.currency).toUpperCase() : null
  if (refundCurrency && orderCurrency && refundCurrency !== orderCurrency) {
    return { kind: 'unidentifiable', amount: refundValue, orderTotal }
  }

  return {
    kind: refundValue >= orderTotal - FULL_REFUND_EPSILON ? 'full' : 'partial',
    amount: refundValue,
    orderTotal,
  }
}
