import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { sendOrderConfirmation } from './emailSenders.js'
import logger from '../utils/logger.js'
import { getPaypalAccessToken, PAYPAL_BASE, PAYPAL_WEBHOOK_ID } from '../utils/paypal.js'
import { paypalReturnUrl, paypalCancelUrl } from '../utils/paypalUrls.js'
import { markOfferPaid } from './offerService.js'
import { decreaseStock, increaseStock } from './centralInventory.js'
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
    // or refunded order.
    if (order.status === 'cancelled' || order.paymentStatus === 'refunded') {
      await prisma.orderTimeline.create({
        data: { orderId: order.id, status: order.status, note: 'PayPal payment received for a cancelled/refunded order — manual review required.' },
      })
      hookLog.error({ orderId: order.id, referenceId }, 'PayPal capture completed for cancelled/refunded order')
      return
    }

    // Pre-flight: never confirm an order whose items are no longer available.
    for (const item of order.items) {
      if (item.productId) {
        const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { stockCount: true, availability: true, name: true } })
        if (!product || product.availability === 'out-of-stock' || product.stockCount < item.quantity) {
          hookLog.error({ productId: item.productId, orderId: order.id }, 'Insufficient stock during PayPal webhook capture — order not confirmed')
          await prisma.orderTimeline.create({
            data: { orderId: order.id, status: order.status, note: 'Payment received but stock insufficient — order not confirmed. Manual review required.' },
          })
          return
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
    if (updated.count === 0) return

    await prisma.orderTimeline.create({
      data: { orderId: order.id, status: 'confirmed', note: 'Payment confirmed via PayPal webhook' },
    })

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

    // Never leave the order silently marked paid when the required stock
    // decrement failed — revert it so the inconsistency is visible and fixable.
    if (stockFailed) {
      // Compensate every successful decrement before reverting the order.
      for (const item of decremented) {
        await increaseStock(item.productId, item.quantity, 'paypal', {
          orderId: order.id,
          note: 'Rollback after partial stock failure (PayPal webhook)',
        }).catch(err => hookLog.error({ err, ...item, orderId: order.id }, 'Stock rollback failed'))
      }
      await prisma.order.updateMany({
        where: { id: order.id, paymentStatus: 'paid' },
        data: { paymentStatus: 'pending', status: 'pending' },
      })
      await prisma.orderTimeline.create({
        data: { orderId: order.id, status: 'pending', note: 'Stock decrement failed after payment — order reverted to pending. Manual review required.' },
      })
      hookLog.error({ orderId: order.id }, 'Stock decrement failed after PayPal webhook capture — order reverted to pending')
      return
    }

    // Accepted-offer flow: mark the linked offer paid (guarded, idempotent).
    // Placed after the stock-failure revert so the offer never shows 'paid'
    // while its order has been rolled back for manual review.
    await markOfferPaid(order.id).catch(err => hookLog.error({ err, orderId: order.id }, 'Offer paid flip failed'))

    await logAudit({
      action: 'order.payment.confirmed', entityType: 'order', entityId: order.id, entityName: order.orderNumber,
      newValue: { paymentStatus: 'paid', status: 'confirmed' },
    })

    // Send confirmation email — guests have no Customer row, so fall back to
    // the email captured at checkout.
    const customer = order.customerId
      ? await prisma.customer.findUnique({ where: { id: order.customerId }, select: { email: true, name: true } })
      : null
    const emailTo = customer?.email || order.shippingEmail
    const emailName = customer?.name || order.shippingFullName || 'Customer'
    if (emailTo) {
      const shippingAddr = [
        order.shippingAddressLine1, order.shippingAddressLine2,
        order.shippingCity, order.shippingState, order.shippingPostalCode, order.shippingCountry,
      ].filter(Boolean).join(', ')

      sendOrderConfirmation({
        to: emailTo, customerName: emailName, orderNumber: order.orderNumber,
        items: order.items.map(i => ({ name: i.productName, quantity: i.quantity, price: Number(i.unitPrice) })),
        subtotal: Number(order.subtotal), shippingCost: Number(order.shippingCost), tax: Number(order.tax), total: Number(order.total),
        shippingAddress: shippingAddr,
      }).catch(err => hookLog.error({ err }, 'Webhook order email failed'))
    }

    hookLog.info({ orderId: order.id, orderNumber: order.orderNumber }, 'Order paid via PayPal webhook')
  } catch (err) {
    hookLog.error({ err }, 'Error handling PayPal capture completed')
  }
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

  // Pre-flight: fail before charging the customer if any item is no longer available.
  for (const item of order.items) {
    if (item.productId) {
      const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { stockCount: true, availability: true, name: true } })
      if (!product || product.availability === 'out-of-stock' || product.stockCount < item.quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${product?.name || 'product'}`), { status: 400 })
      }
    }
  }

  const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
  })

  if (!captureRes.ok) {
    const err: Record<string, unknown> = await captureRes.json() as Record<string, unknown>
    hookLog.error({ err, orderId, paypalOrderId }, 'PayPal capture failed')
    throw Object.assign(new Error('Payment capture failed'), { status: 502 })
  }

  const captureData = await captureRes.json() as {
    status: string
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ amount?: { value?: string; currency_code?: string } }>
      }
    }>
  }
  if (captureData.status !== 'COMPLETED') {
    hookLog.warn({ status: captureData.status, orderId }, 'PayPal capture not completed')
    throw Object.assign(new Error('Payment not completed'), { status: 400 })
  }

  // Amount verification: PayPal must have captured exactly what we charged the
  // customer. A mismatch means tampering or a PayPal-side discrepancy — surface
  // it instead of silently confirming the order.
  const capturedAmount = Number(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value)
  if (Number.isNaN(capturedAmount) || Math.abs(capturedAmount - Number(order.total)) > 0.01) {
    hookLog.error({ orderId, paypalOrderId, capturedAmount, expected: Number(order.total) }, 'PayPal captured amount mismatch')
    throw Object.assign(new Error('Captured amount does not match order total'), { status: 409 })
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
    throw Object.assign(new Error('Order is no longer payable'), { status: 409 })
  }

  await prisma.orderTimeline.create({ data: { orderId, status: 'confirmed', note: 'Payment confirmed via PayPal' } })

  // Reduce stock through the CENTRAL inventory service (atomic + eBay sync).
  let stockFailed = false
  const decremented: Array<{ productId: string; quantity: number }> = []
  for (const item of order.items) {
    if (item.productId) {
      const res = await decreaseStock(item.productId, item.quantity, 'paypal', { orderId })
      if (res.ok) {
        decremented.push({ productId: item.productId, quantity: item.quantity })
      } else {
        stockFailed = true
        hookLog.error({ productId: item.productId, quantity: item.quantity, orderId, reason: res.reason }, 'Stock decrement failed during PayPal capture')
      }
    }
  }

  // Never leave the order silently marked paid when the required stock
  // decrement failed — revert it and surface the failure to the client.
  if (stockFailed) {
    // Compensate every successful decrement before reverting the order.
    for (const item of decremented) {
      await increaseStock(item.productId, item.quantity, 'paypal', {
        orderId,
        note: 'Rollback after partial stock failure (PayPal capture)',
      }).catch(err => hookLog.error({ err, ...item, orderId }, 'Stock rollback failed'))
    }
    await prisma.order.updateMany({
      where: { id: orderId, paymentStatus: 'paid' },
      data: { paymentStatus: 'pending', status: 'pending' },
    })
    await prisma.orderTimeline.create({
      data: { orderId, status: 'pending', note: 'Stock decrement failed after payment — order reverted to pending. Manual review required.' },
    })
    hookLog.error({ orderId }, 'Stock decrement failed after PayPal capture — order reverted to pending')
    throw Object.assign(new Error('Payment captured but stock could not be confirmed. Our team will contact you.'), { status: 409 })
  }

  // Accepted-offer flow: mark the linked offer paid (guarded, idempotent).
  // After the stock-failure revert for the same reason as the webhook path.
  await markOfferPaid(orderId).catch(err => hookLog.error({ err, orderId }, 'Offer paid flip failed'))

  await logAudit({
    action: 'order.payment.confirmed', entityType: 'order', entityId: orderId, entityName: order.orderNumber,
    newValue: { paymentStatus: 'paid', status: 'confirmed', paypalOrderId },
  })

  // Send confirmation email (non-blocking) — fall back to the guest checkout
  // email when there is no Customer record.
  const customer = order.customerId
    ? await prisma.customer.findUnique({ where: { id: order.customerId }, select: { email: true, name: true } })
    : null
  const emailTo = customer?.email || order.shippingEmail
  const emailName = customer?.name || order.shippingFullName || 'Customer'
  if (emailTo) {
    const shippingAddr = [
      order.shippingAddressLine1, order.shippingAddressLine2,
      order.shippingCity, order.shippingState, order.shippingPostalCode, order.shippingCountry,
    ].filter(Boolean).join(', ')

    sendOrderConfirmation({
      to: emailTo, customerName: emailName, orderNumber: order.orderNumber,
      items: order.items.map(i => ({ name: i.productName, quantity: i.quantity, price: Number(i.unitPrice) })),
      subtotal: Number(order.subtotal), shippingCost: Number(order.shippingCost), tax: Number(order.tax), total: Number(order.total),
      shippingAddress: shippingAddr,
    }).catch(err => hookLog.error({ err }, 'Order confirmation email failed'))
  }

  hookLog.info({ orderId, orderNumber: order.orderNumber, paypalOrderId }, 'PayPal payment captured')
  return { status: 'completed' as const, orderId, ...orderSummary }
}
