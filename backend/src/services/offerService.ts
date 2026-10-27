import { prisma } from '../server.js'
import { generateOfferNumber, generateOrderNumber, isProductInStock } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { sendOfferReceived } from './email.js'
import { normalizeEmail } from './authService.js'
import { computeOrderTotals } from './orderPricing.js'
import { getStoreCurrency } from './settingsService.js'
import { isPaypalPayable } from './bankDetailsService.js'
import { CURRENT_TERMS_VERSION } from '../utils/legal.js'
import { formatMoney } from '../utils/money.js'
import {
  checkOfferEligibility,
  eligibilityMessage,
  isPaymentWindowExpired,
  isPayableStatus,
  acceptedAmountOf,
  OFFER_PAYMENT_WINDOW_MS,
  OPEN_OFFER_STATUSES,
  checkOpenOfferLimit,
  checkDailyEmailLimit,
  checkDailyIpLimit,
  offerGuardMessage,
} from './offerRules.js'
import type { Prisma } from '@prisma/client'

// ─── Submission (customer) ────────────────────────────────────

export interface SubmitOfferInput {
  productId: string
  customerEmail: string
  offeredPrice: number
  quantity?: number
  message?: string
  customerId?: string | null
  /** Best-effort submitter IP (trust-proxy-aware) for the G47 flood breaker. */
  submissionIp?: string | null
}

/**
 * Submit an offer. The client's amount is INPUT ONLY: eligibility and validity
 * are decided here, server-side. Logged-in submissions attach the customer so
 * the offer becomes payable from their account; guest submissions remain
 * email-identified leads (existing behavior preserved).
 */
export async function submitOffer(data: SubmitOfferInput) {
  const { productId, customerId } = data
  const quantity = data.quantity && data.quantity > 0 ? data.quantity : 1
  const offeredPrice = Number(data.offeredPrice)

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })

  const reason = checkOfferEligibility({
    makeOfferEnabled: product.makeOfferEnabled,
    showPrice: product.showPrice,
    status: product.status,
    availability: product.availability,
    stockCount: product.stockCount,
    minimumOfferPrice: product.minimumOfferPrice == null ? null : Number(product.minimumOfferPrice),
    requestedQuantity: quantity,
    offeredAmount: offeredPrice,
    regularPrice: Number(product.regularPrice),
  })
  if (reason) throw Object.assign(new Error(eligibilityMessage(reason)), { status: 400 })

  // Sanity floor: never accept a non-positive or absurd offer even if the
  // admin hasn't configured a per-product minimum.
  if (!(offeredPrice > 0) || offeredPrice > Number(product.regularPrice)) {
    throw Object.assign(new Error('Invalid offer amount'), { status: 400 })
  }

  // ── Abuse guards (G47) — fail fast, cheapest first ──────────
  // Open-offer ceiling + rolling 24h budgets per email, then an IP-level
  // flood breaker. All decided server-side from two cheap indexed counts.
  //
  // The email is normalized to lower case first: the counts used to compare
  // exact strings, so `User@x.com` and `user@x.com` each had their own
  // budget and the daily limit could be multiplied by changing the case.
  const customerEmail = normalizeEmail(data.customerEmail)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [openCount, recentForEmail, recentForIp] = await Promise.all([
    prisma.offer.count({ where: { customerEmail, status: { in: [...OPEN_OFFER_STATUSES] } } }),
    prisma.offer.count({ where: { customerEmail, createdAt: { gte: dayAgo } } }),
    data.submissionIp
      ? prisma.offer.count({ where: { submissionIp: data.submissionIp, createdAt: { gte: dayAgo } } })
      : Promise.resolve(0),
  ])
  const guard =
    checkOpenOfferLimit(customerEmail, openCount) ??
    checkDailyEmailLimit(customerEmail, recentForEmail) ??
    checkDailyIpLimit(data.submissionIp, recentForIp)
  if (guard) {
    throw Object.assign(new Error(offerGuardMessage(guard)), { status: 429 })
  }

  const offer = await prisma.offer.create({
    data: {
      offerNumber: await generateOfferNumber(),
      productId,
      customerId: customerId || undefined,
      customerEmail,
      offeredPrice,
      quantity,
      message: data.message,
      submissionIp: data.submissionIp || null,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
    include: { product: { select: { id: true, name: true, regularPrice: true, currency: true } } },
  })

  await logAudit({
    action: 'offer.create',
    entityType: 'offer',
    entityId: offer.id,
    entityName: offer.offerNumber,
    newValue: { offeredPrice, quantity, customerId: customerId || null },
  })

  // Notify admin (non-blocking)
  sendOfferReceived({
    offerNumber: offer.offerNumber,
    productName: product.name,
    offeredPrice,
    customerEmail: data.customerEmail,
    currency: product.currency || 'USD',
  }).catch(() => {})

  return offer
}

// ─── Customer offer access (IDOR-safe) ────────────────────────

export type CustomerOfferView = Prisma.OfferGetPayload<{
  include: {
    product: { select: { id: true; slug: true; name: true; sku: true; regularPrice: true; salePrice: true; images: { select: { url: true; isMain: true; sortOrder: true } } } }
    order: { select: { id: true; orderNumber: true; status: true; paymentStatus: true; total: true; currency: true } }
  }
}>

/** All offers belonging to one customer, newest first. */
export async function listCustomerOffers(customerId: string): Promise<{ offers: CustomerOfferView[] }> {
  // Mark lapsed payment windows before returning the list, otherwise My Offers
  // keeps showing a "Pay Now" button for an offer the pay endpoint will reject.
  const now = new Date()
  await prisma.offer.updateMany({
    where: {
      customerId,
      status: { in: ['accepted', 'awaiting-payment'] },
      OR: [
        { expiresAt: { lt: now } },
        {
          expiresAt: null,
          acceptedAt: { lt: new Date(now.getTime() - OFFER_PAYMENT_WINDOW_MS) },
        },
      ],
    },
    data: { status: 'expired' },
  })

  const offers = await prisma.offer.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: {
          id: true, slug: true, name: true, sku: true, regularPrice: true, salePrice: true,
          images: { select: { url: true, isMain: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
        },
      },
      order: { select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true } },
    },
  })
  return { offers }
}

/** Lazily expire an accepted/awaiting-payment offer whose deadline passed. */
async function expireIfLapsed(offerId: string, status: string, acceptedAt: Date | null, expiresAt: Date | null): Promise<string> {
  if (!isPaymentWindowExpired({ status, acceptedAt, expiresAt })) return status
  const updated = await prisma.offer.updateMany({
    where: { id: offerId, status: { in: ['accepted', 'awaiting-payment'] } },
    data: { status: 'expired' },
  })
  if (updated.count > 0) {
    await logAudit({ action: 'offer.expire', entityType: 'offer', entityId: offerId })
  }
  return 'expired'
}

/**
 * One customer's offer for the checkout path. Verifies ownership (the offer
 * must be linked to this customer account — guest leads have no customerId
 * and can never be paid online), lazily expires a lapsed window, and
 * neutralizes counter prices that the customer hasn't accepted.
 */
export async function getCustomerOfferForPayment(offerId: string, customerId: string) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      product: { select: { id: true, slug: true, name: true, sku: true, regularPrice: true, salePrice: true, availability: true, stockCount: true } },
      order: { select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true } },
    },
  })
  if (!offer) throw Object.assign(new Error('Offer not found'), { status: 404 })
  // IDOR / BOLA guard: only the owning customer may see or pay this offer.
  if (offer.customerId !== customerId) throw Object.assign(new Error('Offer not found'), { status: 404 })

  const status = await expireIfLapsed(offer.id, offer.status, offer.acceptedAt, offer.expiresAt)
  if (!isPayableStatus(status)) {
    throw Object.assign(new Error('This offer cannot be paid'), { status: 400 })
  }

  const product = offer.product
  if (!product) throw Object.assign(new Error('Product no longer exists'), { status: 409 })
  if (!isProductInStock(product)) {
    throw Object.assign(new Error('This product is no longer available'), { status: 409 })
  }

  return {
    offer: {
      id: offer.id,
      offerNumber: offer.offerNumber,
      status,
      quantity: offer.quantity,
      acceptedPrice: Number(acceptedAmountOf(offer)),
      listedPrice: Number(product.regularPrice),
      expiresAt: offer.expiresAt,
      product,
      order: offer.order,
    },
  }
}

// ─── Accepted-offer checkout (server-priced order) ────────────

/**
 * Create (idempotently) the pending Order that carries an accepted offer
 * through the EXISTING PayPal payment flow. Every monetary value is computed
 * here from stored data — the client sends only the offer id and its shipping
 * address. The public product price is never touched.
 */
export async function createOfferOrder(offerId: string, customerId: string, shipping: {
  fullName: string
  addressLine1: string
  addressLine2?: string
  city: string
  state?: string
  postalCode?: string
  country: string
}, termsAccepted: boolean) {
  if (termsAccepted !== true) {
    throw Object.assign(
      new Error('You must accept the Terms of Service, Privacy Policy and Refund Policy before paying this offer.'),
      { status: 400 },
    )
  }

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      product: true,
      order: { select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true } },
    },
  })
  if (!offer) throw Object.assign(new Error('Offer not found'), { status: 404 })
  if (offer.customerId !== customerId) throw Object.assign(new Error('Offer not found'), { status: 404 })

  const status = await expireIfLapsed(offer.id, offer.status, offer.acceptedAt, offer.expiresAt)
  if (!isPayableStatus(status)) {
    throw Object.assign(new Error('This offer cannot be paid'), { status: 400 })
  }

  // Offers settle through PayPal only. Gate BEFORE the awaiting-payment flip:
  // an offer must never be locked into an order the store cannot take payment
  // for — same rule as the storefront checkout's PayPal gate.
  if (!(await isPaypalPayable())) {
    throw Object.assign(
      new Error('PayPal is not available at the moment. Please contact us to complete the payment.'),
      { status: 409 },
    )
  }

  // Idempotency: an offer maps to at most one order (unique FK on orders.offerId).
  if (offer.orderId && offer.order) {
    if (offer.order.paymentStatus === 'paid') {
      throw Object.assign(new Error('This offer has already been paid'), { status: 400 })
    }
    return offer.order
  }

  const product = offer.product
  if (!product) throw Object.assign(new Error('Product no longer exists'), { status: 409 })
  if (product.availability === 'out-of-stock' || product.stockCount < offer.quantity) {
    throw Object.assign(new Error('This product is no longer available'), { status: 409 })
  }

  // ── Server-authoritative pricing ─────────────────────────────
  const negotiatedUnit = acceptedAmountOf(offer)
  const listedUnit = Number(product.regularPrice)
  const subtotal = Math.round(negotiatedUnit * offer.quantity * 100) / 100

  const { shippingCost, tax, total } = await computeOrderTotals(subtotal, shipping.country)
  const currency = await getStoreCurrency()

  // Guarded flip to awaiting-payment makes concurrent double-clicks safe:
  // only the first request proceeds to order creation.
  const claimed = await prisma.offer.updateMany({
    where: { id: offer.id, status, orderId: null },
    data: { status: 'awaiting-payment' },
  })
  if (claimed.count === 0) {
    // Lost the race — re-read and return the winner's order if it exists.
    const winner = await prisma.offer.findUnique({
      where: { id: offer.id },
      include: { order: { select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true } } },
    })
    if (winner?.order) return winner.order
    throw Object.assign(new Error('Offer payment already started'), { status: 409 })
  }

  try {
    const order = await prisma.order.create({
      data: {
        orderNumber: await generateOrderNumber(),
        customerId,
        status: 'pending',
        paymentMethod: 'paypal',
        paymentStatus: 'pending',
        subtotal, shippingCost, tax, total, currency,
        // The accepted-offer flow is still a checkout and must carry the same
        // legal acceptance proof as the normal storefront order.
        termsAcceptedAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
        // Historical pricing snapshot — immutable once paid.
        originalListedPrice: listedUnit,
        negotiatedPrice: negotiatedUnit,
        shippingFullName: shipping.fullName,
        shippingAddressLine1: shipping.addressLine1,
        shippingAddressLine2: shipping.addressLine2 || null,
        shippingCity: shipping.city,
        shippingState: shipping.state || null,
        shippingPostalCode: shipping.postalCode || null,
        shippingCountry: shipping.country,
        offerId: offer.id,
      },
    })

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        quantity: offer.quantity,
        unitPrice: negotiatedUnit,
        totalPrice: subtotal,
      },
    })
    await prisma.orderTimeline.create({
      data: {
        orderId: order.id,
        status: 'pending',
        note: `Created from accepted offer ${offer.offerNumber} — negotiated ${formatMoney(negotiatedUnit, currency)} (listed ${formatMoney(listedUnit, currency)})`,
      },
    })
    // Link the offer to its order. If this write fails the transaction-style
    // catch tears the freshly created order down so no orphan order remains.
    await prisma.offer.update({ where: { id: offer.id }, data: { orderId: order.id } })

    await logAudit({
      action: 'offer.order.created',
      entityType: 'offer',
      entityId: offer.id,
      entityName: offer.offerNumber,
      newValue: { orderId: order.id, orderNumber: order.orderNumber, negotiatedPrice: negotiatedUnit, total },
    })

    const fullOrder = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, timeline: true } })
    return fullOrder!
  } catch (error) {
    // Compensate: release the claim and remove any half-created order.
    await prisma.offer.updateMany({ where: { id: offer.id, status: 'awaiting-payment', orderId: null }, data: { status } }).catch(() => {})
    await prisma.order.deleteMany({ where: { offerId: offer.id, paymentStatus: { not: 'paid' } } }).catch(() => {})
    throw error
  }
}

// ─── Payment confirmation hook (called by PayPal service) ─────

/**
 * Flip the offer linked to a just-paid order to 'paid'. Guarded: only an
 * 'awaiting-payment' offer transitions, so webhook + capture double-fires
 * are idempotent. Called from both PayPal confirmation paths.
 */
export async function markOfferPaid(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { offerId: true } })
  if (!order?.offerId) return
  const updated = await prisma.offer.updateMany({
    where: { id: order.offerId, status: 'awaiting-payment' },
    data: { status: 'paid' },
  })
  if (updated.count > 0) {
    await logAudit({ action: 'offer.paid', entityType: 'offer', entityId: order.offerId })
  }
}

// ─── Counter acceptance (customer accepts admin counter) ──────

/**
 * Customer accepts the admin's counter price: the counter becomes the
 * accepted price and the offer enters the payable window. History is
 * preserved — offeredPrice and counterPrice stay untouched.
 */
export async function acceptCounter(offerId: string, customerId: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } })
  if (!offer || offer.customerId !== customerId) throw Object.assign(new Error('Offer not found'), { status: 404 })
  if (offer.status !== 'countered' || offer.counterPrice == null || Number(offer.counterPrice) <= 0) {
    throw Object.assign(new Error('This offer has no counter to accept'), { status: 400 })
  }

  const updated = await prisma.offer.updateMany({
    where: { id: offer.id, status: 'countered' },
    data: {
      status: 'accepted',
      acceptedPrice: Number(offer.counterPrice),
      acceptedAt: new Date(),
      respondedAt: new Date(),
      // Start the payment window from the customer's acceptance.
      expiresAt: new Date(Date.now() + OFFER_PAYMENT_WINDOW_MS),
    },
  })
  if (updated.count === 0) throw Object.assign(new Error('This offer cannot be accepted'), { status: 409 })

  await logAudit({ action: 'offer.counter.accepted', entityType: 'offer', entityId: offer.id, entityName: offer.offerNumber })
  return { ok: true }
}
