import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { sendOrderPaymentReceived } from './emailSenders.js'
import logger from '../utils/logger.js'
import { getPaypalAccessToken, PAYPAL_BASE, PAYPAL_WEBHOOK_ID, processPaypalRefund } from '../utils/paypal.js'
import { paypalReturnUrl, paypalCancelUrl } from '../utils/paypalUrls.js'
import { markOfferPaid } from './offerService.js'
import { decreaseStock, increaseStock, reserveStock, releaseReservation } from './centralInventory.js'
import { classifyCaptureRefund } from './paypalRefundPolicy.js'
import type { Prisma } from '@prisma/client'

const hookLog = logger.child({ context: 'paypal-service' })

// ─── Webhook Validation ──────────────────────────────────────

const ALLOWED_CERT_URL_PATTERNS = [
  /^https:\/\/api[.]paypal\.com\/v1\/notifications\/cert\/.*$/i,
  /^https:\/\/api-m[.]paypal\.com\/v1\/notifications\/cert\/.*$/i,
  /^https:\/\/api[.]sandbox[.]paypal\.com\/v1\/notifications\/cert\/.*$/i,
  /^https:\/\/api-m[.]sandbox[.]paypal\.com\/v1\/notifications\/cert\/.*$/i,
]

function isValidPaypalCertUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  return ALLOWED_CERT_URL_PATTERNS.some(pattern => pattern.test(url))
}

export async function verifyPayPalWebhook(req: { headers: Record<string, string>; body: unknown }): Promise<boolean> {
  if (!PAYPAL_WEBHOOK_ID) {
    if (process.env.NODE_ENV === 'production') {
      hookLog.fatal('PAYPAL_WEBHOOK_ID not configured in production — rejecting webhook')
      return false
    }
    hookLog.warn('PAYPAL_WEBHOOK_ID not configured — skipping signature verification (dev mode)')
    return true
  }

  const certUrl = req.headers['paypal-cert-url']
  if (!isValidPaypalCertUrl(certUrl)) {
    hookLog.warn({ certUrl }, 'Invalid PayPal cert_url — possible SSRF attempt')
    return false
  }

  try {
    const accessToken = await getPaypalAccessToken()
    if (!accessToken) return false

    const verificationPayload = {
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: certUrl,
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: req.body,
    }

    const response = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(verificationPayload),
    })

    const data = await response.json() as { verification_status: string }
    return data.verification_status === 'SUCCESS'
  } catch (err) {
    hookLog.error({ err }, 'Webhook signature verification failed')
    return false
  }
}

// ─── Webhook Event Logging ──────────────────────────────────

export async function logWebhookEvent(eventType: string, payload: unknown) {
  try {
    await prisma.webhookLog.create({
      data: { source: 'paypal', eventType: eventType || 'unknown', payload: payload as unknown as Prisma.InputJsonValue, status: 'received' },
    })
  } catch (err) {
    hookLog.error({ err }, 'Failed to log webhook')
  }
}

// ─── Capture Completed Handler ───────────────────────────────

export async function handleCaptureCompleted(resource: Record<string, unknown>) {
  try {
    const supplementaryData = resource?.supplementary_data as Record<string, unknown> | undefined
    const relatedIds = supplementaryData?.related_ids as Record<string, unknown> | undefined
    const purchaseUnit = (resource?.purchase_units as Array<Record<string, unknown>> | undefined)?.[0]
    const customId = (resource?.custom_id || purchaseUnit?.custom_id) as string | undefined
    const invoiceId = (resource?.invoice_id || purchaseUnit?.invoice_id) as string | undefined
    const referenceId = (relatedIds?.order_id || resource?.custom_id) as string | undefined
    if (!referenceId && !customId && !invoiceId) return

    // Reconcile in priority order. custom_id / invoice_id are values WE set on
    // the PayPal order, so they still identify the store order after a retry
    // replaced paymentIntentId with a newer PayPal order id.
    let order = customId
      ? await prisma.order.findFirst({
          where: {
            OR: [
              { id: customId },
              { orderNumber: customId },
              { paymentIntentId: customId },
            ],
          },
          include: { items: true },
        })
      : null
    if (!order && invoiceId) order = await prisma.order.findFirst({ where: { orderNumber: invoiceId }, include: { items: true } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { paymentIntentId: referenceId }, include: { items: true } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { orderNumber: referenceId }, include: { items: true } })
    if (!order || order.paymentStatus === 'paid') return
    // A late/duplicate capture notification must never resurrect a cancelled
    // or refunded order. A refunded order is already settled; a cancelled one
    // still needs the captured money returned.
    if (order.paymentStatus === 'refunded') return
    if (order.status === 'cancelled') {
      const refunded = await refundCapturedPaypalOrder(order)
      if (refunded) {
        await prisma.order.updateMany({
          where: { id: order.id },
          data: { paymentStatus: 'refunded' },
        })
      }
      await prisma.orderTimeline.create({
        data: {
          orderId: order.id,
          status: order.status,
          note: refunded
            ? 'PayPal payment received for a cancelled order — refunded automatically.'
            : 'PayPal payment received for a cancelled order — REFUND FAILED, manual refund required.',
        },
      })
      hookLog.error({ orderId: order.id, referenceId, refunded }, 'PayPal capture completed for cancelled order')
      return
    }

    // Pre-flight: never confirm an order whose items are no longer available.
    // The money was already captured, so return it automatically instead of
    // leaving the customer paid for an unfulfillable order.
    //
    // If the capture path already claimed the stock, `stockReserved` is true
    // and the units are already deducted for THIS order. Re-checking the
    // remaining shelf count would then see zero and wrongly refund a perfectly
    // reserved sale. The marker is the authority; only unreserved orders need
    // the availability check.
    if (!order.stockReserved) {
      for (const item of order.items) {
        if (item.productId) {
          const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { stockCount: true, availability: true, name: true } })
          if (!product || product.availability === 'out-of-stock' || product.stockCount < item.quantity) {
            const refunded = await refundCapturedPaypalOrder(order)
            await prisma.order.updateMany({
              where: { id: order.id },
              data: {
                paymentStatus: refunded ? 'refunded' : 'pending',
                status: 'pending',
                stockReserved: false,
              },
            })
            await prisma.orderTimeline.create({
              data: {
                orderId: order.id,
                status: 'pending',
                note: refunded
                  ? 'Payment received but stock insufficient — payment refunded automatically and order not confirmed.'
                  : 'Payment received but stock insufficient — REFUND FAILED, order not confirmed. Manual refund required.',
              },
            })
            hookLog.error({ productId: item.productId, orderId: order.id, refunded }, 'Insufficient stock during PayPal webhook capture — payment refunded')
            return
          }
        }
      }
    }

    // Atomic guard: only transition to paid if not already paid
    const updated = await prisma.order.updateMany({
      where: {
        id: order.id,
        status: { not: 'cancelled' },
        paymentStatus: { notIn: ['paid', 'refunded'] },
      },
      data: { paymentStatus: 'paid', status: 'confirmed' },
    })
    if (updated.count === 0) {
      // The order changed state between the initial read and the atomic
      // transition. If it was cancelled while the capture notification was in
      // flight, the cancellation path may have seen `paymentStatus: pending`
      // and therefore not refunded. Return the captured money here, and give
      // back any reservation the cancellation path did not already release.
      const latest = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true, paymentStatus: true, stockReserved: true },
      })
      if (latest?.status === 'cancelled' && latest.paymentStatus !== 'paid' && latest.paymentStatus !== 'refunded') {
        const refunded = await refundCapturedPaypalOrder(order)
        const release = await prisma.order.updateMany({
          where: { id: order.id, stockReserved: true },
          data: { stockReserved: false },
        })
        if (release.count > 0) {
          const reserved = order.items
            .filter((item) => item.productId)
            .map((item) => ({ productId: item.productId as string, quantity: item.quantity }))
          if (reserved.length > 0) {
            await releaseReservation(reserved, 'paypal', {
              orderId: order.id,
              note: 'Order cancelled during PayPal webhook confirmation',
            })
          }
        }
        if (refunded) {
          await prisma.order.updateMany({
            where: { id: order.id, paymentStatus: { not: 'paid' } },
            data: { paymentStatus: 'refunded' },
          })
        }
        await prisma.orderTimeline.create({
          data: {
            orderId: order.id,
            status: 'cancelled',
            note: refunded
              ? 'Payment received for a cancelled order — refunded automatically and stock released.'
              : 'Payment received for a cancelled order — REFUND FAILED, manual refund required. Stock released.',
          },
        })
        hookLog.error({ orderId: order.id, refunded }, 'PayPal capture completed after cancellation — handled')
      }
      return
    }

    await prisma.orderTimeline.create({
      data: { orderId: order.id, status: 'confirmed', note: 'Payment confirmed via PayPal webhook' },
    })

    // The capture path may have reserved the stock before charging. The
    // `stockReserved` marker tells us who owns the units, so the order is
    // never decremented twice and never left unsold.
    const alreadyReserved = await prisma.order.findUnique({
      where: { id: order.id },
      select: { stockReserved: true },
    })
    if (alreadyReserved?.stockReserved) {
      hookLog.info({ orderId: order.id }, 'Stock already reserved by the capture path — skipping webhook decrement')
      await markOfferPaid(order.id).catch(err => hookLog.error({ err, orderId: order.id }, 'Offer paid flip failed'))
      await sendWebhookPaymentEmail(order).catch(err => hookLog.error({ err }, 'Webhook order email failed'))
      hookLog.info({ orderId: order.id, orderNumber: order.orderNumber }, 'Order paid via PayPal webhook')
      return
    }

    // Reduce stock through the CENTRAL inventory service — atomic guard
    // prevents negative stock, availability flag follows, eBay mirrors enqueue.
    let stockFailed = false
    const decremented: Array<{ productId: string; quantity: number }> = []
    for (const item of order.items) {
      if (item.productId) {
        const res = await decreaseStock(item.productId, item.quantity, 'paypal', { orderId: order.id })
        if (res.ok) {
          decremented.push({ productId: item.productId, quantity: item.quantity })
        } else {
          stockFailed = true
          hookLog.error({ productId: item.productId, quantity: item.quantity, orderId: order.id, reason: res.reason }, 'Stock decrement failed during webhook capture')
        }
      }
    }

    // Never leave the order marked paid when the required stock decrement
    // failed. The money is already captured at this point, so the customer is
    // refunded automatically — an unpaid-to-the-customer order must never stay
    // "pending" with the cash taken.
    if (stockFailed) {
      // Compensate every successful decrement before reverting the order.
      for (const item of decremented) {
        await increaseStock(item.productId, item.quantity, 'paypal', {
          orderId: order.id,
          note: 'Rollback after partial stock failure (PayPal webhook)',
        }).catch(err => hookLog.error({ err, ...item, orderId: order.id }, 'Stock rollback failed'))
      }
      const refunded = await refundCapturedPaypalOrder(order)
      await prisma.order.updateMany({
        where: { id: order.id, paymentStatus: 'paid' },
        data: { paymentStatus: refunded ? 'refunded' : 'pending', status: 'pending', stockReserved: false },
      })
      await prisma.orderTimeline.create({
        data: {
          orderId: order.id,
          status: 'pending',
          note: refunded
            ? 'Stock decrement failed after payment — payment refunded automatically and order reverted to pending.'
            : 'Stock decrement failed after payment — REFUND FAILED, order reverted to pending. Manual refund required.',
        },
      })
      hookLog.error({ orderId: order.id, refunded }, 'Stock decrement failed after PayPal webhook capture')
      return
    }

    await prisma.order.updateMany({ where: { id: order.id }, data: { stockReserved: true } })

    // Accepted-offer flow: mark the linked offer paid (guarded, idempotent).
    // Placed after the stock-failure revert so the offer never shows 'paid'
    // while its order has been rolled back for manual review.
    await markOfferPaid(order.id).catch(err => hookLog.error({ err, orderId: order.id }, 'Offer paid flip failed'))

    await logAudit({
      action: 'order.payment.confirmed', entityType: 'order', entityId: order.id, entityName: order.orderNumber,
      newValue: { paymentStatus: 'paid', status: 'confirmed' },
    })

    // Send the payment-received notice — guests have no Customer row, so fall
    // back to the email captured at checkout. The order-received confirmation
    // already went out at placement.
    await sendWebhookPaymentEmail(order)

    hookLog.info({ orderId: order.id, orderNumber: order.orderNumber }, 'Order paid via PayPal webhook')
  } catch (err) {
    hookLog.error({ err }, 'Error handling PayPal capture completed')
  }
}

/**
 * Sends the "payment received" notice for a webhook-confirmed order.
 */
async function sendWebhookPaymentEmail(order: {
  customerId: string | null
  shippingEmail: string | null
  shippingFullName: string | null
  orderNumber: string
  total: unknown
  currency: string | null
}): Promise<void> {
  const customer = order.customerId
    ? await prisma.customer.findUnique({ where: { id: order.customerId }, select: { email: true, name: true } })
    : null
  const emailTo = customer?.email || order.shippingEmail
  if (!emailTo) return
  const emailName = customer?.name || order.shippingFullName || 'Customer'
  await sendOrderPaymentReceived({
    to: emailTo, customerName: emailName, orderNumber: order.orderNumber,
    total: Number(order.total), currency: order.currency || 'USD',
    paymentMethod: 'PayPal',
  })
}

/**
 * Refunds a PayPal capture for an order. Used when the payment was taken but
 * the order could not be fulfilled — the customer must never keep money for an
 * order they did not get.
 */
async function refundCapturedPaypalOrder(order: {
  id: string
  orderNumber: string
  paymentIntentId: string | null
  total: unknown
  currency: string | null
}): Promise<boolean> {
  if (!order.paymentIntentId) {
    hookLog.error({ orderId: order.id }, 'No PayPal order id stored — cannot refund automatically')
    return false
  }
  const refund = await processPaypalRefund(
    order.paymentIntentId,
    Number(order.total),
    order.currency || 'USD',
  )
  if (refund.success) {
    hookLog.info({ orderId: order.id, orderNumber: order.orderNumber }, 'PayPal refund processed automatically')
    return true
  }
  hookLog.error({ orderId: order.id, orderNumber: order.orderNumber, error: refund.error }, 'Automatic PayPal refund FAILED')
  return false
}

export async function handleCaptureFailed(resource: Record<string, unknown>) {
  try {
    const supplementaryData = resource?.supplementary_data as Record<string, unknown> | undefined
    const relatedIds = supplementaryData?.related_ids as Record<string, unknown> | undefined
    const purchaseUnit = (resource?.purchase_units as Array<Record<string, unknown>> | undefined)?.[0]
    const customId = (resource?.custom_id || purchaseUnit?.custom_id) as string | undefined
    const invoiceId = (resource?.invoice_id || purchaseUnit?.invoice_id) as string | undefined
    const referenceId = (relatedIds?.order_id || resource?.custom_id) as string | undefined
    if (!referenceId && !customId && !invoiceId) return

    let order = customId
      ? await prisma.order.findFirst({
          where: {
            OR: [
              { id: customId },
              { orderNumber: customId },
              { paymentIntentId: customId },
            ],
          },
        })
      : null
    if (!order && invoiceId) order = await prisma.order.findFirst({ where: { orderNumber: invoiceId } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { paymentIntentId: referenceId } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { orderNumber: referenceId } })
    if (!order) return

    // Only downgrade an order that is still awaiting payment. A stale or
    // out-of-order denial must not undo a paid/refunded/cancelled state.
    const updated = await prisma.order.updateMany({
      where: {
        id: order.id,
        status: { not: 'cancelled' },
        paymentStatus: { notIn: ['paid', 'refunded'] },
      },
      data: { paymentStatus: 'pending' },
    })
    if (updated.count === 0) {
      hookLog.warn({ orderId: order.id, paymentStatus: order.paymentStatus, status: order.status }, 'Ignored stale PayPal capture denial')
      return
    }

    await prisma.orderTimeline.create({ data: { orderId: order.id, status: order.status, note: 'PayPal payment capture denied' } })

    hookLog.warn({ orderId: order.id }, 'PayPal capture denied')
  } catch (err) {
    hookLog.error({ err }, 'Error handling PayPal capture failed')
  }
}

/**
 * PAYMENT.CAPTURE.REFUNDED — money left through PayPal's own side (dashboard
 * refund, dispute resolution, buyer self-service reversal) and this store
 * must agree. Mirrors the admin-cancel refund semantics: a FULL refund marks
 * the payment refunded AND returns the claimed units (both capture paths
 * deduct stock before the paid flip, so restore via increaseStock the way
 * restoreStockAndRefund does). A partial refund moves no state — only a
 * timeline note. Idempotent: the not-'refunded' guard turns a replayed or
 * duplicate delivery into a no-op that releases nothing, and the
 * stockReserved guard makes the stock restore one-shot.
 */
export async function handleCaptureRefunded(resource: Record<string, unknown>) {
  try {
    const supplementaryData = resource?.supplementary_data as Record<string, unknown> | undefined
    const relatedIds = supplementaryData?.related_ids as Record<string, unknown> | undefined
    const purchaseUnit = (resource?.purchase_units as Array<Record<string, unknown>> | undefined)?.[0]
    const customId = (resource?.custom_id || purchaseUnit?.custom_id) as string | undefined
    const invoiceId = (resource?.invoice_id || purchaseUnit?.invoice_id) as string | undefined
    const referenceId = (relatedIds?.order_id || resource?.custom_id) as string | undefined
    if (!referenceId && !customId && !invoiceId) {
      hookLog.warn('PayPal refund webhook carries no order reference — nothing to reconcile')
      return
    }

    // Same priority-order reconciliation as the capture/denied handlers.
    let order = customId
      ? await prisma.order.findFirst({
          where: {
            OR: [
              { id: customId },
              { orderNumber: customId },
              { paymentIntentId: customId },
            ],
          },
          include: { items: true },
        })
      : null
    if (!order && invoiceId) order = await prisma.order.findFirst({ where: { orderNumber: invoiceId }, include: { items: true } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { paymentIntentId: referenceId }, include: { items: true } })
    if (!order && referenceId) order = await prisma.order.findFirst({ where: { orderNumber: referenceId }, include: { items: true } })
    if (!order) {
      hookLog.warn({ referenceId }, 'PayPal refund for an order this store cannot find — manual check recommended')
      return
    }

    const classification = classifyCaptureRefund(resource, {
      total: Number(order.total),
      currency: order.currency,
    })

    if (classification.kind === 'unidentifiable') {
      await prisma.orderTimeline.create({
        data: {
          orderId: order.id,
          status: order.status,
          note: 'PayPal refund notification could not be reconciled (amount or currency) — manual check required.',
        },
      })
      hookLog.warn({ orderId: order.id, orderNumber: order.orderNumber, amount: classification.amount, orderTotal: classification.orderTotal }, 'Unreconcilable PayPal refund notification')
      return
    }

    if (classification.kind === 'partial') {
      await prisma.orderTimeline.create({
        data: {
          orderId: order.id,
          status: order.status,
          note: `Partial PayPal refund received (${classification.amount} ${order.currency || ''}) — payment state unchanged; release stock only on a full refund.`,
        },
      })
      hookLog.info({ orderId: order.id, amount: classification.amount }, 'Partial PayPal refund — no payment state change')
      return
    }

    // Full refund. Atomic transition first — a replayed or duplicate
    // delivery no-ops here and releases nothing the second time.
    const transitioned = await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: { not: 'refunded' } },
      data: { paymentStatus: 'refunded' },
    })
    if (transitioned.count === 0) {
      hookLog.info({ orderId: order.id }, 'Duplicate PayPal refunded delivery ignored (already refunded)')
      return
    }

    // Units were deducted when this order was paid (both capture paths claim
    // them). Return them exactly the way the admin-cancel path does.
    const claim = await prisma.order.updateMany({
      where: { id: order.id, stockReserved: true },
      data: { stockReserved: false },
    })
    if (claim.count > 0) {
      const items = order.items
        .filter((item) => item.productId)
        .map((item) => ({ productId: item.productId as string, quantity: item.quantity }))
      for (const item of items) {
        await increaseStock(item.productId, item.quantity, 'paypal', {
          orderId: order.id,
          note: 'PayPal refund confirmed — claimed stock returned to the shelf',
        })
      }
    }

    await prisma.orderTimeline.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: 'Full PayPal refund confirmed — payment refunded and claimed stock returned to the shelf.',
      },
    })

    await logAudit({
      action: 'order.payment.refunded', entityType: 'order', entityId: order.id, entityName: order.orderNumber,
      newValue: { paymentStatus: 'refunded', refundedAmount: classification.amount },
    })

    hookLog.warn({ orderId: order.id, orderNumber: order.orderNumber, amount: classification.amount }, 'PayPal refunded the buyer — order marked refunded and stock returned')
  } catch (err) {
    hookLog.error({ err }, 'Error handling PayPal capture refunded')
  }
}

// ─── Storefront Payment Flow ─────────────────────────────────

export async function createPaypalOrder(orderId: string, userId: string | null) {
  // Guest orders have customerId = null; a signed-in user can only pay their
  // own orders. Never let one customer address another customer's order.
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId ?? null },
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  if (order.status === 'cancelled') throw Object.assign(new Error('Order has been cancelled'), { status: 400 })
  if (order.paymentStatus === 'paid') throw Object.assign(new Error('Order already paid'), { status: 400 })
  if (order.paymentStatus === 'refunded') throw Object.assign(new Error('Order has been refunded'), { status: 400 })

  const accessToken = await getPaypalAccessToken()
  if (!accessToken) throw Object.assign(new Error('Failed to connect to PayPal'), { status: 502 })

  // Reuse a still-open PayPal order instead of replacing paymentIntentId on
  // every click. Overwriting it used to make an approval of the earlier order
  // impossible to match back to this store order.
  if (order.paymentIntentId) {
    try {
      const existingRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(order.paymentIntentId)}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      })
      if (existingRes.ok) {
        const existing = await existingRes.json() as { id?: string; status?: string }
        if ((existing.status === 'CREATED' || existing.status === 'APPROVED') && existing.id) {
          return { paypalOrderId: existing.id }
        }
        if (existing.status === 'COMPLETED') {
          // Payment already happened; the webhook (or a capture retry) will
          // confirm it. Never create a second chargeable order.
          throw Object.assign(new Error('Payment is already being processed'), { status: 409 })
        }
      }
    } catch (err) {
      // 409 is ours; anything else (network/expired id) falls through to a new
      // PayPal order. Reconciliation now uses custom_id/invoice_id, so a late
      // capture of an older order still resolves to this store order.
      if ((err as { status?: number }).status === 409) throw err
    }
  }

  const paypalOrderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.orderNumber,
        // Reconcile even if a retry created a newer PayPal order: these values
        // identify OUR order, independent of PayPal's order id.
        custom_id: order.id,
        invoice_id: order.orderNumber,
        description: `Order ${order.orderNumber} — Alka Traders`,
        amount: {
          currency_code: order.currency || 'USD',
          value: Number(order.total).toFixed(2),
          breakdown: {
            item_total: { currency_code: order.currency || 'USD', value: Number(order.subtotal).toFixed(2) },
            shipping: { currency_code: order.currency || 'USD', value: Number(order.shippingCost).toFixed(2) },
            tax_total: { currency_code: order.currency || 'USD', value: Number(order.tax).toFixed(2) },
          },
        },
      }],
      application_context: {
        brand_name: 'Alka Traders',
        landing_page: 'BILLING',
        user_action: 'PAY_NOW',
        return_url: paypalReturnUrl(orderId),
        cancel_url: paypalCancelUrl(),
      },
    }),
  })

  if (!paypalOrderRes.ok) {
    const err: Record<string, unknown> = await paypalOrderRes.json() as Record<string, unknown>
    hookLog.error({ err, orderId }, 'PayPal create order failed')
    throw Object.assign(new Error('PayPal order creation failed'), { status: 502 })
  }

  const paypalData = await paypalOrderRes.json() as { id: string }
  hookLog.info({ orderId, paypalOrderId: paypalData.id }, 'PayPal order created')

  await prisma.order.update({ where: { id: orderId }, data: { paymentIntentId: paypalData.id } })

  return { paypalOrderId: paypalData.id }
}

export async function capturePaypalOrder(paypalOrderId: string, orderId: string, userId: string | null) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId ?? null },
    include: { items: true },
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  // Ownership cross-check: the PayPal order being captured must be the exact
  // one created for this store order — never trust a client-supplied ID.
  if (order.paymentIntentId !== paypalOrderId) {
    hookLog.warn({ orderId, paypalOrderId, storedPaymentIntentId: order.paymentIntentId }, 'PayPal order ID mismatch during capture')
    throw Object.assign(new Error('PayPal order does not match this order'), { status: 400 })
  }
  if (order.status === 'cancelled') throw Object.assign(new Error('Order has been cancelled'), { status: 400 })
  if (order.paymentStatus === 'refunded') throw Object.assign(new Error('Order has been refunded'), { status: 400 })

  // Totals returned to the return-URL handler so it can render the confirmation
  // without a second authenticated order lookup (guest orders have none).
  const orderSummary = {
    orderNumber: order.orderNumber,
    subtotal: Number(order.subtotal),
    shippingCost: Number(order.shippingCost),
    tax: Number(order.tax),
    total: Number(order.total),
    currency: order.currency,
    // Guest checkout: the redirect return has no checkout form state, but the
    // confirmation page still needs the email to authorize tracking/cancellation.
    shippingEmail: order.shippingEmail || null,
  }

  // Idempotent: the PayPal redirect and the webhook can both land before the
  // customer sees the success page. Replaying capture for the exact same PayPal
  // order must not fail or charge twice.
  if (order.paymentStatus === 'paid') {
    return { status: 'completed' as const, orderId, ...orderSummary }
  }

  const accessToken = await getPaypalAccessToken()
  if (!accessToken) throw Object.assign(new Error('Failed to connect to PayPal'), { status: 502 })

  // Pre-flight: fail before charging the customer if any item is no longer
  // available. If `stockReserved` is already true, the units are reserved for
  // this order — a concurrent capture or the webhook got here first, and the
  // remaining shelf count no longer represents this order's claim.
  if (!order.stockReserved) {
    for (const item of order.items) {
      if (item.productId) {
        const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { stockCount: true, availability: true, name: true } })
        if (!product || product.availability === 'out-of-stock' || product.stockCount < item.quantity) {
          throw Object.assign(new Error(`Insufficient stock for ${product?.name || 'product'}`), { status: 400 })
        }
      }
    }
  }

  // ─── Reserve stock BEFORE charging the customer ───────────────
  // The order row carries the ownership marker (`stockReserved`). Claiming it
  // first guarantees that exactly one path — this one or the PayPal webhook —
  // decrements the units for this order, so the order can never be
  // double-decremented or left unsold.
  const claim = await prisma.order.updateMany({
    where: { id: orderId, stockReserved: false, status: { not: 'cancelled' } },
    data: { stockReserved: true },
  })
  if (claim.count === 0) {
    // The webhook path already owns the stock for this order (or it was
    // already processed). Never charge on top of that.
    const latest = await prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true, status: true },
    })
    if (latest?.paymentStatus === 'paid') {
      return { status: 'completed' as const, orderId, ...orderSummary }
    }
    throw Object.assign(new Error('Order is no longer payable'), { status: 409 })
  }

  const reservation = await reserveStock(
    order.items
      .filter((item) => item.productId)
      .map((item) => ({ productId: item.productId as string, quantity: item.quantity })),
    'paypal',
    { orderId },
  )

  if (!reservation.ok) {
    // Nothing was charged — give the ownership marker back and tell the
    // customer the item is gone.
    await prisma.order.updateMany({ where: { id: orderId }, data: { stockReserved: false } })
    await prisma.orderTimeline.create({
      data: { orderId, status: order.status, note: 'Stock reservation failed before payment — no charge made.' },
    })
    hookLog.error({ orderId, failedProductId: reservation.failedProductId, reason: reservation.reason }, 'Stock reservation failed before PayPal capture')
    throw Object.assign(new Error('Insufficient stock for one or more items. No payment was taken.'), { status: 409 })
  }

  // Anything that goes wrong from here on must give the reservation back —
  // unless the webhook already confirmed the payment, in which case the stock
  // must stay claimed (the customer paid for it).
  const abortReservation = async (note: string) => {
    // Claim the release atomically. An admin cancellation can release the same
    // reservation while the PayPal call is in flight; only the path that flips
    // the marker from true to false may put the units back.
    const claim = await prisma.order.updateMany({
      where: { id: orderId, stockReserved: true, paymentStatus: { not: 'paid' } },
      data: { stockReserved: false },
    })
    if (claim.count === 0) {
      const latest = await prisma.order.findUnique({
        where: { id: orderId },
        select: { paymentStatus: true },
      })
      if (latest?.paymentStatus === 'paid') {
        hookLog.warn({ orderId, note }, 'Payment already confirmed — keeping the stock reservation')
      } else {
        hookLog.warn({ orderId, note }, 'Stock reservation already released by another path')
      }
      return
    }

    // A webhook may have confirmed the payment between the claim and this
    // point. In that case the reservation belongs to a paid sale; restore the
    // marker and keep the units claimed.
    const confirmed = await prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true },
    })
    if (confirmed?.paymentStatus === 'paid') {
      await prisma.order.updateMany({ where: { id: orderId }, data: { stockReserved: true } })
      hookLog.warn({ orderId, note }, 'Payment confirmed during abort — keeping the stock reservation')
      return
    }

    await releaseReservation(reservation.reserved, 'paypal', { orderId, note })
  }

  let captureData: {
    status: string
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ amount?: { value?: string; currency_code?: string } }>
      }
    }>
  }
  try {
    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    })

    if (!captureRes.ok) {
      // The capture never happened — release the reservation so the units are
      // sellable again.
      await abortReservation('Release after failed PayPal capture')
      const err: Record<string, unknown> = await captureRes.json().catch(() => ({})) as Record<string, unknown>
      hookLog.error({ err, orderId, paypalOrderId }, 'PayPal capture failed')
      throw Object.assign(new Error('Payment capture failed'), { status: 502 })
    }

    captureData = await captureRes.json() as typeof captureData
  } catch (err) {
    // Network failure / unexpected throw: the capture may or may not have gone
    // through. Release the stock unless the webhook already confirmed payment.
    await abortReservation('Release after PayPal capture error')
    if (err && typeof err === 'object' && 'status' in err) throw err
    hookLog.error({ err, orderId, paypalOrderId }, 'PayPal capture request failed')
    throw Object.assign(new Error('Payment capture failed'), { status: 502 })
  }

  if (captureData.status !== 'COMPLETED') {
    await abortReservation('Release after incomplete PayPal capture')
    hookLog.warn({ status: captureData.status, orderId }, 'PayPal capture not completed')
    throw Object.assign(new Error('Payment not completed'), { status: 400 })
  }

  // Amount verification: PayPal must have captured exactly what we charged the
  // customer. A mismatch means tampering or a PayPal-side discrepancy — refund
  // the capture, release the stock, and surface the failure instead of
  // silently confirming the order.
  const capturedAmount = Number(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value)
  if (Number.isNaN(capturedAmount) || Math.abs(capturedAmount - Number(order.total)) > 0.01) {
    hookLog.error({ orderId, paypalOrderId, capturedAmount, expected: Number(order.total) }, 'PayPal captured amount mismatch')
    const refund = await processPaypalRefund(paypalOrderId, Number(order.total), order.currency || 'USD')
    await abortReservation('Release after amount mismatch refund')
    await prisma.orderTimeline.create({
      data: {
        orderId, status: order.status,
        note: refund.success
          ? 'Captured amount mismatch — payment refunded automatically and stock released.'
          : 'Captured amount mismatch — REFUND FAILED, manual refund required.',
      },
    })
    if (refund.success) {
      hookLog.error({ orderId }, 'PayPal captured amount mismatch — refunded automatically')
      throw Object.assign(new Error('Payment amount did not match the order total. You have been refunded.'), { status: 409 })
    }
    hookLog.error({ orderId, refundError: refund.error }, 'PayPal captured amount mismatch — automatic refund FAILED')
    throw Object.assign(new Error('Payment could not be verified and the automatic refund failed. Our team will contact you.'), { status: 409 })
  }

  // Atomic idempotency guard
  const updated = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: { not: 'cancelled' },
      paymentStatus: { notIn: ['paid', 'refunded'] },
    },
    data: { paymentStatus: 'paid', status: 'confirmed' },
  })
  if (updated.count === 0) {
    // Lost a race with the webhook or an admin action. Only report success when
    // the order is actually paid; a cancelled/refunded order must not be shown
    // to the customer as a completed payment.
    const latest = await prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true },
    })
    if (latest?.paymentStatus === 'paid') {
      return { status: 'completed' as const, orderId, ...orderSummary }
    }
    // The order was cancelled while we were charging. Refund the capture and
    // give the stock back — never keep money for a cancelled order.
    const refund = await processPaypalRefund(paypalOrderId, Number(order.total), order.currency || 'USD')
    await abortReservation('Release after order cancellation')
    hookLog.error({ orderId, refunded: refund.success }, 'Order cancelled during PayPal capture')
    throw Object.assign(
      new Error(refund.success
        ? 'This order was cancelled. Your payment has been refunded.'
        : 'This order was cancelled and the automatic refund failed. Our team will contact you.'),
      { status: 409 },
    )
  }

  await prisma.orderTimeline.create({ data: { orderId, status: 'confirmed', note: 'Payment confirmed via PayPal' } })

  // Stock was already reserved before the capture — the reservation IS the
  // decrement. Nothing left to claim here.
  await prisma.order.updateMany({ where: { id: orderId }, data: { stockReserved: true } })

  // Accepted-offer flow: mark the linked offer paid (guarded, idempotent).
  // After the stock-failure revert for the same reason as the webhook path.
  await markOfferPaid(orderId).catch(err => hookLog.error({ err, orderId }, 'Offer paid flip failed'))

  await logAudit({
    action: 'order.payment.confirmed', entityType: 'order', entityId: orderId, entityName: order.orderNumber,
    newValue: { paymentStatus: 'paid', status: 'confirmed', paypalOrderId },
  })

  // Send the payment-received notice (non-blocking) — fall back to the guest
  // checkout email when there is no Customer record. The order-received
  // confirmation was already sent when the order was placed, so this is a
  // distinct "your money arrived" message, not a duplicate receipt.
  const customer = order.customerId
    ? await prisma.customer.findUnique({ where: { id: order.customerId }, select: { email: true, name: true } })
    : null
  const emailTo = customer?.email || order.shippingEmail
  const emailName = customer?.name || order.shippingFullName || 'Customer'
  if (emailTo) {
    sendOrderPaymentReceived({
      to: emailTo, customerName: emailName, orderNumber: order.orderNumber,
      total: Number(order.total), currency: order.currency || 'USD',
      paymentMethod: 'PayPal',
    }).catch(err => hookLog.error({ err }, 'Order payment-received email failed'))
  }

  hookLog.info({ orderId, orderNumber: order.orderNumber, paypalOrderId }, 'PayPal payment captured')
  return { status: 'completed' as const, orderId, ...orderSummary }
}
