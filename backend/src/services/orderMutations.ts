import { prisma } from '../server.js'
import { generateOrderNumber, getEffectivePrice } from '../utils/helpers.js'
import { orderInclude } from '../utils/prisma-helpers.js'
import { logAudit } from '../utils/audit.js'
import { sendOrderShipped, sendOrderCancelled, sendOrderConfirmation, sendOrderPaymentReceived } from './emailSenders.js'
import { notifyOrderEvent } from './adminNotifications.js'
import { escapeHtml } from '../utils/html-escape.js'
import logger from '../utils/logger.js'
import { processPaypalRefund } from '../utils/paypal.js'
import { decreaseStock, increaseStock, reserveStock, releaseReservation } from './centralInventory.js'
import { computeOrderTotals } from './orderPricing.js'
import { getStoreTimezone, getStoreCurrency } from './settingsService.js'
import { getBankDetails, getLetterOfCreditDetails, isBankTransferPayable, isLetterOfCreditUsable, isPaypalPayable, buildPaymentReference, type BankDetails } from './bankDetailsService.js'
import { CURRENT_TERMS_VERSION } from '../utils/legal.js'
import { formatMoney } from '../utils/money.js'
import type { AuthUser } from '../middleware/auth.js'
import type { Order } from '@prisma/client'

const STATUS_FLOW = ['pending', 'confirmed', 'paid', 'processing', 'packed', 'shipped', 'delivered']

/** Payment method ids that are settled offline by the customer. */
const BANK_PAYMENT_METHODS = new Set(['bank-transfer', 'bank', 'wire'])
/** Letter of credit is a different offline arrangement from a bank transfer. */
const LC_PAYMENT_METHODS = new Set(['lc', 'letter-of-credit', 'letterofcredit'])

export function isBankPaymentMethod(method: string): boolean {
  return BANK_PAYMENT_METHODS.has(String(method || '').toLowerCase())
}

export function isLetterOfCreditMethod(method: string): boolean {
  return LC_PAYMENT_METHODS.has(String(method || '').toLowerCase())
}

/**
 * Builds the payment-instruction block for an offline order.
 *
 * Bank transfer → the account to pay into, the amount and the reference.
 * Letter of credit → the accepting banks and the documents to present.
 *
 * Returns null when the method is settled online (PayPal) — those orders are
 * paid by the provider, not by transfer.
 */
async function buildPaymentInstructions(
  paymentMethod: string,
  orderNumber: string,
  total: number,
  currency: string,
): Promise<{
  details: { label: string; value: string }[]
  note: string
  heading: string
} | null> {
  if (isLetterOfCreditMethod(paymentMethod)) {
    const lc = await getLetterOfCreditDetails()
    if (!isLetterOfCreditUsable(lc)) {
      throw Object.assign(
        new Error('Letter of credit is not available at the moment. Please choose another payment method or contact us.'),
        { status: 409 },
      )
    }
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(total)
    const details: { label: string; value: string }[] = [
      { label: 'Contract value', value: `<strong style="color:#b45309;">${amount}</strong>` },
      { label: 'Payment reference', value: `<strong>${escapeHtml(orderNumber)}</strong>` },
    ]
    if (lc.acceptingBanks) details.push({ label: 'Accepting banks', value: escapeHtml(lc.acceptingBanks) })
    if (lc.documentsRequired) details.push({ label: 'Documents required', value: escapeHtml(lc.documentsRequired) })
    const note = [
      lc.notes,
      `Please reference "${orderNumber}" in the credit application. Our team will issue the draft documents for your bank to examine.`,
    ].filter(Boolean).join(' ')
    return { heading: 'Letter of credit arrangement', details, note }
  }

  if (!isBankPaymentMethod(paymentMethod)) {
    // The storefront order schema accepts exactly three methods: bank-transfer,
    // lc and paypal — so anything that is not offline settles through PayPal.
    // Gate it like the offline methods: an order must never be created when no
    // payment session can settle it (credentials unset or admin-disabled),
    // because the customer would be stuck with an order nobody can pay.
    if (!(await isPaypalPayable())) {
      throw Object.assign(
        new Error('PayPal is not available at the moment. Please contact us to complete your order.'),
        { status: 409 },
      )
    }
    return null
  }

  const bank: BankDetails = await getBankDetails()
  if (!isBankTransferPayable(bank)) {
    throw Object.assign(
      new Error('Bank transfer is not available at the moment. Please choose another payment method or contact us.'),
      { status: 409 },
    )
  }

  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(total)
  const details: { label: string; value: string }[] = [
    { label: 'Amount to transfer', value: `<strong style="color:#b45309;">${amount}</strong>` },
    { label: 'Payment reference', value: `<strong>${escapeHtml(buildPaymentReference(bank, orderNumber))}</strong>` },
  ]
  if (bank.bankName) details.push({ label: 'Bank name', value: escapeHtml(bank.bankName) })
  if (bank.accountName) details.push({ label: 'Account name', value: escapeHtml(bank.accountName) })
  if (bank.accountNumber) details.push({ label: 'Account number', value: `<strong>${escapeHtml(bank.accountNumber)}</strong>` })
  if (bank.iban) details.push({ label: 'IBAN', value: escapeHtml(bank.iban) })
  if (bank.swift) details.push({ label: 'SWIFT / BIC', value: escapeHtml(bank.swift) })
  if (bank.ifsc) details.push({ label: 'IFSC', value: escapeHtml(bank.ifsc) })

  const note = [
    bank.instructions,
    `Please quote the payment reference "${buildPaymentReference(bank, orderNumber)}" on your transfer so we can match the payment to your order.`,
  ].filter(Boolean).join(' ')

  return {
    heading: 'Bank transfer instructions',
    details,
    note,
  }
}

export interface CreateOrderInput {
  items: { productId: string; quantity: number }[]
  shipping: {
    fullName: string; email?: string; addressLine1: string; addressLine2?: string
    city: string; state?: string; postalCode?: string; country: string
    phone?: string; company?: string; taxId?: string
  }
  paymentMethod: string
  customerNotes?: string
  idempotencyKey?: string
  customerId?: string | null
  /** Explicit acceptance of the published terms. Required for every order. */
  termsAccepted: boolean
}

/** Normalises the email used to scope a guest idempotency key. */
function normalizedEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase()
}

/**
 * An idempotency key is only a replay token for the checkout that created it.
 * Returning another customer's order because they guessed the key would leak
 * the order and its address. Signed-in orders are scoped by customer id;
 * guest orders are scoped by the checkout email.
 */
function idempotencyScopeMatches(
  order: { customerId: string | null; shippingEmail: string | null },
  customerId: string | null | undefined,
  guestEmail: string,
): boolean {
  if (customerId) return order.customerId === customerId
  return order.customerId === null && normalizedEmail(order.shippingEmail) === guestEmail
}

// ─── Create Order ──────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  const { items, shipping, paymentMethod, customerNotes, idempotencyKey, customerId, termsAccepted } = input

  // Gate 6: acceptance is enforced here, not only by the disabled state of a
  // button in the browser. A direct API call must not create an order without
  // the same legal acceptance the checkout UI collects.
  if (termsAccepted !== true) {
    throw Object.assign(
      new Error('You must accept the Terms of Service, Privacy Policy and Refund Policy before placing an order.'),
      { status: 400 },
    )
  }

  // Guest orders have no Customer row, so the email supplied at checkout is
  // the only way to send confirmations and shipping updates.
  if (!customerId && !shipping.email?.trim()) {
    throw Object.assign(new Error('Email address is required for guest checkout'), { status: 400 })
  }
  const guestEmail = normalizedEmail(shipping.email)

  if (idempotencyKey) {
    // A dedicated column with a unique constraint, instead of searching the
    // customer-visible notes for a "[idem:…]" marker. The old approach coupled
    // de-duplication to a free-text field, used a non-unique `contains`, and
    // only worked inside a five-minute window.
    const existingOrder = await prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: true },
    })
    if (existingOrder) {
      if (!idempotencyScopeMatches(existingOrder, customerId, guestEmail)) {
        throw Object.assign(
          new Error('This checkout reference has already been used. Please refresh the page and try again.'),
          { status: 409 },
        )
      }
      return existingOrder
    }
  }

  // Prices are stored as bare decimals; the currency is stored once on the
  // order. A product priced in another currency cannot be silently charged at
  // the same numeric amount in the store's settlement currency.
  const currency = await getStoreCurrency()

  let subtotal = 0
  const orderItems: Array<{
    productId: string; productName: string; productSku: string
    quantity: number; unitPrice: number; totalPrice: number
  }> = []
  /**
   * Lines that can no longer be bought. The old behaviour silently dropped
   * these from the order after it had already been created: the customer saw
   * the missing lines only on the confirmation page, when the order existed
   * and the cart was gone. Instead, refuse the order before anything is
   * written and tell the client exactly which product ids to remove, so the
   * customer can review the corrected cart and place the order deliberately.
   */
  const unavailableItems: Array<{ field: string; message: string }> = []

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } })
    if (!product) {
      logger.warn({ productId: item.productId }, 'Order line unavailable — product not found in catalog')
      unavailableItems.push({ field: item.productId, message: 'This product is no longer in the catalog.' })
      continue
    }
    if (product.status !== 'published') {
      // Draft/hidden/archived products must never be purchasable through the
      // public checkout, even if the client sends their UUID.
      logger.warn({ productId: item.productId, status: product.status }, 'Order line unavailable — product is not published')
      unavailableItems.push({ field: item.productId, message: `${product.name} is no longer available.` })
      continue
    }
    const productCurrency = String(product.currency || '').trim().toUpperCase() || currency
    if (productCurrency !== currency) {
      // No FX conversion exists in the store. Refuse the line instead of
      // charging its numeric amount in a different currency.
      throw Object.assign(
        new Error(`${product.name} is priced in ${productCurrency}, but this store settles orders in ${currency}. Please contact us for a quote.`),
        { status: 400 },
      )
    }
    if (product.availability === 'out-of-stock' || product.stockCount < item.quantity) {
      throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { status: 400 })
    }
    // Date-aware: an expired or not-yet-started sale must never be charged.
    const price = getEffectivePrice(product)
    orderItems.push({
      productId: product.id, productName: product.name, productSku: product.sku,
      quantity: item.quantity, unitPrice: price, totalPrice: price * item.quantity,
    })
    subtotal += price * item.quantity
  }

  if (unavailableItems.length > 0) {
    throw Object.assign(
      new Error('Some items in your cart are no longer available. Remove them and review your order before placing it.'),
      { status: 409, details: unavailableItems },
    )
  }

  // If every line was unavailable (e.g. entirely empty catalog), fail with a
  // clear, actionable error instead of a confusing 400 crash mid-checkout.
  if (orderItems.length === 0) {
    throw Object.assign(
      new Error('The items in your cart are no longer available. Please review your cart and try again.'),
      { status: 409 }
    )
  }

  // Shipping is priced by the customer's country from the admin-configured
  // shipping zones; when no zone matches (or none are configured) it falls back
  // to the flat checkout.shippingCost + free-shipping threshold. The server
  // always calculates this — the client can never dictate shipping.
  const { shippingCost, tax, total } = await computeOrderTotals(subtotal, shipping.country)

  // The order number is generated up front: the payment reference the customer
  // must quote on a bank transfer is derived from it, and it has to be in the
  // confirmation email.
  const orderNumber = await generateOrderNumber()

  // Resolve payment instructions before the order is written. For an offline
  // (bank transfer) order this throws when the store has no usable bank
  // details — an order nobody can pay must never be created.
  const paymentInstructions = await buildPaymentInstructions(paymentMethod, orderNumber, total, currency)

  // The order, its lines and the timeline entry are written in ONE
  // transaction. Previously the order was created first and the items were
  // added in a loop with a compensating delete on failure — a crash in the
  // middle could leave a partially-created order behind.
  let order: Order
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber, customerId,
          status: 'pending', paymentMethod, paymentStatus: 'pending',
          subtotal, shippingCost, tax, total, currency,
          idempotencyKey: idempotencyKey || null,
          termsAcceptedAt: new Date(),
          termsVersion: CURRENT_TERMS_VERSION,
          shippingFullName: shipping.fullName,
          shippingEmail: customerId ? null : (shipping.email?.trim() || null),
          shippingAddressLine1: shipping.addressLine1,
          shippingAddressLine2: shipping.addressLine2 || null,
          shippingCity: shipping.city,
          shippingState: shipping.state || null,
          shippingPostalCode: shipping.postalCode || null,
          shippingCountry: shipping.country,
          shippingPhone: shipping.phone?.trim() || null,
          shippingCompany: shipping.company?.trim() || null,
          shippingTaxId: shipping.taxId?.trim() || null,
          customerNotes: customerNotes || null,
        },
      })

      for (const i of orderItems) {
        await tx.orderItem.create({ data: { orderId: created.id, ...i } })
      }

      await tx.orderTimeline.create({
        data: {
          orderId: created.id,
          status: 'pending',
          note: 'Order placed',
        },
      })

      return created
    })
  } catch (err: unknown) {
    // Two requests can pass the lookup above at the same time. The unique
    // constraint decides the winner; the loser re-reads the winner's order and
    // returns it only when the idempotency scope matches.
    if (idempotencyKey && (err as { code?: string }).code === 'P2002') {
      const existingOrder = await prisma.order.findUnique({
        where: { idempotencyKey },
        include: { items: true },
      })
      if (existingOrder) {
        if (!idempotencyScopeMatches(existingOrder, customerId, guestEmail)) {
          throw Object.assign(
            new Error('This checkout reference has already been used. Please refresh the page and try again.'),
            { status: 409 },
          )
        }
        return existingOrder
      }
    }
    throw err
  }

  // Offline payment (bank transfer / L/C): the customer pays after the order
  // exists, so the stock must be claimed NOW. Without this the last unit can
  // be sold twice while the transfer or credit is being arranged. The
  // reservation is released if the order is cancelled.
  if (isBankPaymentMethod(paymentMethod) || isLetterOfCreditMethod(paymentMethod)) {
    const reservation = await reserveStock(
      orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      'website',
      { orderId: order.id },
    )
    if (!reservation.ok) {
      // Another buyer took the units between the availability check and now.
      // No confirmation has been sent yet: delete the order before telling the
      // customer anything, so an "order received" email can never describe an
      // order that no longer exists.
      await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
      logger.error({ orderId: order.id, productId: reservation.failedProductId }, 'Stock reservation failed for bank transfer order')
      throw Object.assign(new Error('Insufficient stock for one or more items. Please review your cart and try again.'), { status: 409 })
    }
    await prisma.order.update({ where: { id: order.id }, data: { stockReserved: true } })
    await prisma.orderTimeline.create({
      data: { orderId: order.id, status: 'pending', note: 'Stock reserved while awaiting payment' },
    })
  }

  const fullOrder = await prisma.order.findUnique({
    where: { id: order.id },
    include: { items: true, timeline: true },
  })

  await logAudit({
    action: 'order.create', entityType: 'order',
    entityId: order.id, entityName: order.orderNumber,
    newValue: order,
  })

  notifyOrderEvent('orderPlaced', {
    orderNumber: order.orderNumber,
    status: 'pending',
    customerName: shipping.fullName,
    total,
    currency,
  }).catch(err => logger.error({ err }, 'Admin order notification failed'))

  // Every order gets a customer confirmation at placement — including guest
  // orders. This runs only after stock has been successfully reserved, so a
  // failed reservation never leaves a confirmation for a deleted order.
  await sendOrderPlacedConfirmation({
    order,
    items: orderItems,
    shippingEmail: customerId ? null : (shipping.email?.trim() || null),
    customerId,
    customerName: shipping.fullName,
    total,
    tax,
    shippingCost,
    subtotal,
    currency,
    paymentInstructions,
    paymentMethod,
  })

  return fullOrder
}

/**
 * Sends the "order received" confirmation to the customer. Never throws: a
 * failed email must not roll back an order that was already created — the
 * failure is logged and the admin alert still fires.
 */
async function sendOrderPlacedConfirmation(params: {
  order: { id: string; orderNumber: string }
  items: Array<{ productName: string; quantity: number; unitPrice: number }>
  shippingEmail: string | null
  customerId?: string | null
  customerName: string
  subtotal: number
  shippingCost: number
  tax: number
  total: number
  currency: string
  paymentMethod: string
  paymentInstructions: { heading: string; details: { label: string; value: string }[]; note: string } | null
}) {
  const recipient = params.customerId
    ? await prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { email: true, name: true },
    })
    : null
  const email = recipient?.email || params.shippingEmail
  if (!email) {
    logger.warn({ orderId: params.order.id }, 'No customer email for order confirmation — guest order without email')
    return
  }

  const order = await prisma.order.findUnique({
    where: { id: params.order.id },
    select: {
      shippingAddressLine1: true, shippingAddressLine2: true, shippingCity: true,
      shippingState: true, shippingPostalCode: true, shippingCountry: true,
      shippingCompany: true,
    },
  })
  const shippingAddr = [
    order?.shippingCompany,
    order?.shippingAddressLine1, order?.shippingAddressLine2, order?.shippingCity,
    order?.shippingState, order?.shippingPostalCode, order?.shippingCountry,
  ].filter(Boolean).join(', ')

  try {
    await sendOrderConfirmation({
      to: email,
      customerName: recipient?.name || params.customerName || 'Customer',
      orderNumber: params.order.orderNumber,
      items: params.items.map(i => ({ name: i.productName, quantity: i.quantity, price: Number(i.unitPrice) })),
      subtotal: params.subtotal,
      shippingCost: params.shippingCost,
      tax: params.tax,
      total: params.total,
      shippingAddress: shippingAddr,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
      paymentInstructions: params.paymentInstructions ?? undefined,
      paymentPending: params.paymentInstructions !== null,
    })
  } catch (err) {
    logger.error({ err, orderId: params.order.id }, 'Order confirmation email failed at placement')
  }
}

// ─── Request Cancellation ──────────────────────────────────────

export async function requestOrderCancellation(
  id: string,
  customerId: string | null,
  reason?: string,
  guestEmail?: string,
) {
  // Signed-in customers can only cancel their own orders. Guests prove
  // ownership with the email address used at checkout (their order is stored
  // with customerId = null).
  const address = guestEmail?.trim()
  if (!customerId && !address) {
    throw Object.assign(new Error('Order not found'), { status: 404 })
  }

  const where = customerId
    ? { id, customerId }
    : { id, customerId: null, shippingEmail: { equals: address, mode: 'insensitive' as const } }

  const order = await prisma.order.findFirst({ where })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  if (order.status === 'cancelled') throw Object.assign(new Error('Order already cancelled'), { status: 400 })
  // Idempotent: retries must not create duplicate timeline entries or emails.
  if (order.cancelRequested) return order

  const updated = await prisma.order.update({
    where: { id },
    data: { cancelRequested: true, cancelReason: reason || 'Customer requested', cancelRequestedAt: new Date() },
  })

  await prisma.orderTimeline.create({
    data: { orderId: id, status: order.status, note: 'Cancellation requested: ' + (reason || 'No reason provided') },
  })

  const cancelCustomer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, name: true } })
    : order.shippingEmail
      ? { email: order.shippingEmail, name: order.shippingFullName || 'Customer' }
      : null

  if (cancelCustomer) {
    sendOrderCancelled({
      to: cancelCustomer.email, customerName: cancelCustomer.name,
      orderNumber: updated.orderNumber, reason: reason || 'Customer cancellation request',
    }).catch(err => logger.error({ err }, 'Order cancel email failed'))
  }

  return updated
}

// ─── Admin: Update Status ──────────────────────────────────────

export async function updateOrderStatus(id: string, status: string, note: string | undefined, actor: AuthUser, ipAddress = '') {
  const order = await prisma.order.findUnique({ where: { id } })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  // A cancelled order is terminal: re-submitting cancellation must not run the
  // stock-restore/refund compensation a second time or resend notifications.
  if (status === 'cancelled' && order.status === 'cancelled') {
    throw Object.assign(new Error('Order is already cancelled'), { status: 400 })
  }

  const currentIdx = STATUS_FLOW.indexOf(order.status)
  const newIdx = STATUS_FLOW.indexOf(status)

  if (status !== 'cancelled' && (currentIdx === -1 || newIdx <= currentIdx)) {
    throw Object.assign(new Error('Can only advance order status forward'), { status: 400 })
  }

  let updated = await prisma.order.update({ where: { id }, data: { status } })

  await prisma.orderTimeline.create({
    data: { orderId: id, status, note, createdBy: actor.id },
  })

  if (status === 'paid' && order.paymentStatus !== 'paid') {
    // The stock may already be claimed: a bank-transfer order reserves it at
    // placement, and a PayPal order reserves it before the capture. Decrement
    // again in that case and the units would be sold twice.
    const alreadyReserved = order.stockReserved
    if (!alreadyReserved) {
      const items = await prisma.orderItem.findMany({ where: { orderId: id } })
      let stockFailed = false
      const decremented: Array<{ productId: string; quantity: number }> = []
      for (const item of items) {
        if (item.productId) {
          const res = await decreaseStock(item.productId, item.quantity, 'website', { orderId: id })
          if (!res.ok) {
            stockFailed = true
            logger.error({ productId: item.productId, quantity: item.quantity, orderId: id, reason: res.reason }, 'Stock decrement failed during admin order confirmation')
          } else {
            decremented.push({ productId: item.productId, quantity: item.quantity })
          }
        }
      }
      // Never leave the order marked paid when the required stock decrement failed.
      // Restore every unit already claimed so a retry does not double-decrement.
      if (stockFailed) {
        for (const item of decremented) {
          await increaseStock(item.productId, item.quantity, 'website', {
            orderId: id,
            note: 'Rollback after partial stock failure (admin order confirmation)',
          }).catch(err => logger.error({ err, ...item, orderId: id }, 'Admin stock rollback failed'))
        }
        await prisma.order.update({ where: { id }, data: { status: order.status } })
        await prisma.orderTimeline.create({
          data: { orderId: id, status: order.status, note: 'Stock decrement failed — order reverted. Manual review required.' },
        })
        throw Object.assign(new Error('Order could not be confirmed: stock decrement failed. Manual review required.'), { status: 409 })
      }
      await prisma.order.update({ where: { id }, data: { stockReserved: true } })
    }

    // Admin marked the order paid: keep paymentStatus in sync with the status,
    // otherwise the order stays "pending" for payment and cancellation will
    // skip the refund/stock-restore path.
    updated = await prisma.order.update({ where: { id }, data: { paymentStatus: 'paid' } })
  }

  if (status === 'cancelled') {
    // A paid order restores its stock and refunds the payment. An unpaid order
    // that is holding a reservation (bank transfer awaiting payment) releases
    // it, so the units go back on sale.
    if (order.paymentStatus === 'paid') {
      await restoreStockAndRefund(id, order)
    } else if (order.stockReserved) {
      await releaseOrderReservation(id, 'Order cancelled before payment')
    }
  }

  await logAudit({
    actor, action: 'order.status.update', entityType: 'order',
    entityId: order.id, entityName: order.orderNumber,
    newValue: { status }, ipAddress,
  })

  // PayPal/card capture already sends the payment confirmation. Admin merely
  // advancing the fulfilment status to "paid" must not email the customer again.
  if (status === 'paid' && order.paymentStatus !== 'paid' && order.paymentMethod !== 'card') {
    await sendOrderPaidEmail(id, order)
  }
  if (status === 'cancelled') {
    await sendOrderCancelledEmail(order)
  }

  // Admin order-event alert, gated by Settings → Notifications. "Shipped" is
  // fired from updateTracking (tracking added) so the two paths never duplicate.
  const adminKey = status === 'confirmed' ? 'orderConfirmed' as const
    : status === 'delivered' ? 'orderDelivered' as const
    : status === 'cancelled' ? 'orderCancelled' as const
    : null
  if (adminKey) {
    const contact = await orderCustomerContact(order)
    notifyOrderEvent(adminKey, {
      orderNumber: order.orderNumber, status, total: Number(order.total), currency: order.currency, note, ...contact,
    }).catch(err => logger.error({ err }, 'Admin order notification failed'))
  }

  return updated
}

// ─── Admin: Update Tracking ────────────────────────────────────

export async function updateTracking(id: string, trackingNumber: string, courier: string) {
  const order = await prisma.order.update({
    where: { id }, data: { trackingNumber, courier },
  })

  const recipient = await orderContact(order)
  if (recipient) {
    sendOrderShipped({
      to: recipient.email, customerName: recipient.name,
      orderNumber: order.orderNumber, trackingNumber, courier,
    }).catch(err => logger.error({ err }, 'Ship email failed'))
  }

  const contact = await orderCustomerContact(order)
  notifyOrderEvent('orderShipped', {
    orderNumber: order.orderNumber, status: order.status,
    total: Number(order.total), currency: order.currency, note: `Tracking ${trackingNumber} (${courier})`, ...contact,
  }).catch(err => logger.error({ err }, 'Admin order notification failed'))

  return order
}

// ─── Admin: Cancel Order ───────────────────────────────────────

export async function cancelOrder(id: string, reason: string | undefined, actor: AuthUser, ipAddress = '') {
  const existingOrder = await prisma.order.findUnique({ where: { id } })
  if (!existingOrder) throw Object.assign(new Error('Order not found'), { status: 404 })
  if (existingOrder.status === 'cancelled') throw Object.assign(new Error('Order already cancelled'), { status: 400 })

  // Atomic transition: two admins (or a retried request) must not both restore
  // stock and refund the same order.
  const cancelled = await prisma.order.updateMany({
    where: { id, status: { not: 'cancelled' } },
    data: { status: 'cancelled', cancelRequested: false, cancelReason: reason || 'Cancelled by admin' },
  })
  if (cancelled.count === 0) {
    throw Object.assign(new Error('Order already cancelled'), { status: 400 })
  }
  const order = await prisma.order.findUnique({ where: { id } })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })

  await prisma.orderTimeline.create({
    data: { orderId: id, status: 'cancelled', note: reason, createdBy: actor.id },
  })

  if (order.paymentStatus === 'paid') {
    await restoreStockAndRefund(id, order)
  } else if (order.stockReserved) {
    await releaseOrderReservation(id, 'Order cancelled before payment')
  }

  await logAudit({
    actor, action: 'order.cancel', entityType: 'order',
    entityId: order.id, entityName: order.orderNumber, ipAddress,
  })

  await sendOrderCancelledEmail(order)

  const contact = await orderCustomerContact(order)
  notifyOrderEvent('orderCancelled', {
    orderNumber: order.orderNumber, status: 'cancelled',
    total: Number(order.total), currency: order.currency, note: reason, ...contact,
  }).catch(err => logger.error({ err }, 'Admin order notification failed'))

  return order
}

// ─── Generate Invoice HTML ─────────────────────────────────────

export async function generateInvoiceHtml(id: string) {
  const order = await prisma.order.findUnique({
    where: { id }, include: orderInclude,
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })

  const money = (value: number) => formatMoney(value, order.currency)
  const items = (order.items || []).map((item: any) =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(item.product?.name || item.productName || 'Product')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${escapeHtml(item.product?.sku || item.sku || '')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(Number(item.unitPrice || item.price || 0))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${money(Number(item.unitPrice || item.price || 0) * item.quantity)}</td>
    </tr>`
  ).join('')

  // Format the invoice date in the admin-configured store timezone (site.timezone).
  const timezone = await getStoreTimezone().catch(() => undefined)
  const invoiceDate = order.createdAt.toLocaleDateString('en-US', timezone ? { timeZone: timezone } : undefined)

  const customer = (order as Record<string, unknown>).customer as Record<string, string> || {}
  const shipping = {
    fullName: order.shippingFullName || '',
    email: order.shippingEmail || '',
    addressLine1: order.shippingAddressLine1 || '',
    city: order.shippingCity || '',
    country: order.shippingCountry || '',
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(order.orderNumber)}</title></head><body>
    <div style="display:flex;justify-content:space-between;margin-bottom:30px">
      <div><h1 style="margin:0;color:#0EA5E9">ALKA TRADERS</h1><p style="color:#666;font-size:13px">Marine & Industrial Equipment</p></div>
      <div style="text-align:right"><h2 style="margin:0">INVOICE</h2><p style="font-family:monospace;font-size:14px;color:#666">#${order.orderNumber}</p><p style="font-size:13px;color:#666">Date: ${invoiceDate}</p></div>
    </div>
    <div style="display:flex;gap:40px;margin-bottom:30px">
      <div style="flex:1"><h3 style="font-size:12px;text-transform:uppercase;color:#999;margin-bottom:8px">Bill To</h3><p style="font-size:13px"><strong>${escapeHtml(customer.name || shipping.fullName || 'N/A')}</strong></p><p style="font-size:13px;color:#666">${escapeHtml(customer.email || shipping.email || '')}</p><p style="font-size:13px;color:#666">${escapeHtml(shipping.addressLine1 || '')}${shipping.city ? ', ' + escapeHtml(shipping.city) : ''}${shipping.country ? ', ' + escapeHtml(shipping.country) : ''}</p></div>
      <div style="flex:1"><h3 style="font-size:12px;text-transform:uppercase;color:#999;margin-bottom:8px">Payment</h3><p style="font-size:13px">Method: ${escapeHtml(order.paymentMethod || 'N/A')}</p><p style="font-size:13px">Status: ${escapeHtml(order.paymentStatus || 'pending')}</p>${order.trackingNumber ? `<p style="font-size:13px">Tracking: ${escapeHtml(order.trackingNumber)} (${escapeHtml(order.courier || '')})</p>` : ''}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">${items}</table>
    <div style="margin-top:20px;text-align:right">
      <p style="font-size:13px">Subtotal: ${money(Number(order.subtotal || 0))}</p>
      <p style="font-size:13px">Shipping: ${money(Number(order.shippingCost || 0))}</p>
      <p style="font-size:13px">Tax: ${money(Number(order.tax || 0))}</p>
      <p style="font-size:18px;font-weight:bold;border-top:2px solid #333;padding-top:8px;margin-top:8px">Grand Total: ${money(Number(order.total || 0))}</p>
    </div>
  </body></html>`
}

// ─── Private Helpers ──────────────────────────────────────────

/** Contact details for admin order alerts (guest email when available). */
async function orderCustomerContact(order: { customerId: string | null; shippingEmail?: string | null; shippingFullName?: string | null }): Promise<{ customerName?: string; customerEmail?: string }> {
  if (order.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: order.customerId }, select: { name: true, email: true },
    })
    if (customer) return { customerName: customer.name, customerEmail: customer.email }
  }
  if (order.shippingEmail) {
    return { customerName: order.shippingFullName || 'Guest customer', customerEmail: order.shippingEmail }
  }
  return {}
}

/** Delivery address for order emails — Customer.email or guest checkout email. */
async function orderContact(order: {
  customerId: string | null
  shippingEmail?: string | null
  shippingFullName?: string | null
}): Promise<{ email: string; name: string } | null> {
  if (order.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: order.customerId }, select: { email: true, name: true },
    })
    if (customer) return { email: customer.email, name: customer.name }
  }
  if (order.shippingEmail) {
    return { email: order.shippingEmail, name: order.shippingFullName || 'Customer' }
  }
  return null
}

async function restoreStockAndRefund(id: string, order: any) {
  const items = await prisma.orderItem.findMany({ where: { orderId: id } })
  // The reservation (or the decrement done when the order was marked paid) is
  // what is being given back — the flag records that the units were claimed.
  for (const item of items) {
    if (item.productId) {
      await increaseStock(item.productId, item.quantity, 'admin', { orderId: id, note: 'cancellation restore' })
    }
  }
  await prisma.order.update({ where: { id }, data: { stockReserved: false } }).catch(() => {})

  let refunded = false
  if (order.paymentIntentId && order.paymentMethod === 'paypal') {
    const refundResult = await processPaypalRefund(
      order.paymentIntentId, Number(order.total), order.currency || 'USD'
    )
    if (refundResult.success) {
      refunded = true
      logger.info({ orderId: order.id, orderNumber: order.orderNumber }, 'PayPal refund processed')
    } else {
      // Never mark the order as refunded when the actual refund failed — the
      // customer would show as refunded without the money ever being returned.
      logger.error({ orderId: order.id, error: refundResult.error }, 'PayPal refund failed — order NOT marked as refunded')
      await prisma.orderTimeline.create({
        data: { orderId: id, status: 'cancelled', note: 'PayPal refund FAILED — customer has not been refunded. Manual refund required.' },
      })
    }
  } else {
    // No automated PayPal refund needed (bank transfer / card / no intent id) —
    // preserve the existing behavior of marking the order refunded.
    refunded = true
  }

  if (refunded) {
    await prisma.order.update({ where: { id }, data: { paymentStatus: 'refunded' } })
  }
}

/**
 * Gives a stock reservation back to the catalogue.
 *
 * Used when an order is cancelled before it was paid: the units were claimed
 * at placement so they could not be sold twice while the customer arranged
 * payment. Cancelling the order must put them back on sale.
 */
async function releaseOrderReservation(orderId: string, note: string) {
  // Claim the release atomically. Cancellation and the PayPal capture path can
  // both decide to give the reservation back; only the path that flips the
  // marker from true to false may add the units back, or stock would be
  // restored twice.
  const claim = await prisma.order.updateMany({
    where: { id: orderId, stockReserved: true },
    data: { stockReserved: false },
  })
  if (claim.count === 0) {
    await prisma.orderTimeline.create({
      data: { orderId, status: 'cancelled', note: `Stock reservation already released — ${note}` },
    }).catch(() => {})
    return
  }

  const items = await prisma.orderItem.findMany({ where: { orderId } })
  const reserved = items
    .filter((item) => item.productId)
    .map((item) => ({ productId: item.productId as string, quantity: item.quantity }))
  if (reserved.length === 0) return

  await releaseReservation(reserved, 'website', { orderId, note })
  await prisma.orderTimeline.create({
    data: { orderId, status: 'cancelled', note: `Stock reservation released — ${note}` },
  }).catch(() => {})
}

async function sendOrderPaidEmail(id: string, order: any) {
  const recipient = await orderContact(order)
  if (!recipient) return

  // The order-received confirmation already went out at placement. This is the
  // payment-confirmed notice, not a second copy of the same email.
  sendOrderPaymentReceived({
    to: recipient.email, customerName: recipient.name,
    orderNumber: order.orderNumber,
    total: Number(order.total),
    currency: order.currency || 'USD',
    paymentMethod: order.paymentMethod || undefined,
  }).catch(err => logger.error({ err }, 'Order payment-received email failed'))
}

async function sendOrderCancelledEmail(order: any) {
  const recipient = await orderContact(order)
  if (!recipient) return

  sendOrderCancelled({
    to: recipient.email, customerName: recipient.name,
    orderNumber: order.orderNumber, reason: order.cancelReason || 'Cancelled by admin',
  }).catch(err => logger.error({ err }, 'Cancel email failed'))
}
