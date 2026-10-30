import { prisma } from '../server.js'
import { generateRfqNumber, generateOrderNumber, generateOfferNumber, paginationParams, paginationResponse } from '../utils/helpers.js'
import { rfqInclude } from '../utils/prisma-helpers.js'
import { logAudit } from '../utils/audit.js'
import { sendRfqReceived, sendRfqResponse } from './email.js'
import { shouldNotify, getStoreCurrency } from './settingsService.js'
import { computeOrderTotals } from './orderPricing.js'
import logger from '../utils/logger.js'
import type { AuthUser } from '../middleware/auth.js'

// ─── Types ────────────────────────────────────────────────────

export interface RfqFilters {
  status?: string
  urgency?: string
  assignedTo?: string
  search?: string
  page?: number
  limit?: number
}

// ─── Storefront ───────────────────────────────────────────────

export async function createRfq(data: {
  fullName: string; company?: string; email: string; phone?: string
  country?: string; role?: string; productDescription: string
  partNumber?: string; brand?: string; quantity?: number
  deliveryLocation?: string; urgency?: string; notes?: string
  source?: string; consent: boolean
  consentAt?: string; policyAccepted: boolean; policyAcceptedAt: string
}) {
  // `Rfq.source` is VarChar(50) in Postgres while the request schema allows
  // 200 characters — clamp here so an over-long client value can never fail
  // the insert with a 500. (The storefront already truncates its generated
  // attribution tokens; this protects against any other client.)
  const { notes, consentAt, policyAccepted, policyAcceptedAt, ...dbFields } = {
    ...data,
    source: data.source?.slice(0, 50),
  }
  const rfq = await prisma.rfq.create({
    data: {
      rfqNumber: await generateRfqNumber(),
      ...dbFields,
      internalNotes: [
        notes,
        policyAccepted ? `Return and Exchange Policy accepted at ${new Date(policyAcceptedAt).toISOString()}` : null,
      ].filter(Boolean).join('\n\n') || null,
      // The agreement is only meaningful with a timestamp.
      ...(consentAt ? { consentAt: new Date(consentAt) } : {}),
      status: 'new',
      responseDeadline: data.urgency === 'emergency'
        ? new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
        : data.urgency === 'urgent'
          ? new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
          : null,
    },
  })

  await logAudit({
    action: 'rfq.create',
    entityType: 'rfq',
    entityId: rfq.id,
    entityName: rfq.rfqNumber,
    newValue: rfq,
  })

  // Notify admin team (non-blocking), honouring the admin notification prefs
  // saved in Settings → Notifications (store.notifications).
  const emergency = data.urgency === 'emergency'
  let notify = true
  try {
    const [received, urgent] = await Promise.all([shouldNotify('rfqReceived'), shouldNotify('rfqUrgent')])
    notify = received && (!emergency || urgent)
  } catch (err) {
    logger.warn({ err }, 'RFQ notification prefs lookup failed; notifying anyway')
  }
  if (notify) {
    sendRfqReceived({
      rfqNumber: rfq.rfqNumber,
      customerName: data.fullName,
      customerEmail: data.email,
      productDescription: data.productDescription,
      urgency: data.urgency || 'standard',
    }).catch(err => logger.error({ err }, 'RFQ email failed'))
  }

  return rfq
}

// ─── Queries ──────────────────────────────────────────────────

export async function listRfqs(params: RfqFilters) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)

  const where: any = {}
  if (params.status) where.status = params.status
  if (params.urgency) where.urgency = params.urgency
  if (params.assignedTo) where.assignedTo = params.assignedTo
  if (params.search) {
    where.OR = [
      { fullName: { contains: params.search, mode: 'insensitive' } },
      { email: { contains: params.search, mode: 'insensitive' } },
      { company: { contains: params.search, mode: 'insensitive' } },
      { rfqNumber: { contains: params.search, mode: 'insensitive' } },
      { productDescription: { contains: params.search, mode: 'insensitive' } },
      { partNumber: { contains: params.search, mode: 'insensitive' } },
    ]
  }

  const statusWhere = { ...where }
  delete statusWhere.status

  const [rfqs, total, grouped] = await Promise.all([
    prisma.rfq.findMany({
      where,
      include: rfqInclude,
      orderBy: [{ urgency: 'asc' }, { createdAt: 'desc' }],
      skip, take: limit,
    }),
    prisma.rfq.count({ where }),
    // Tab badges must count every matching RFQ, not only the current page.
    prisma.rfq.groupBy({ by: ['status'], where: statusWhere, _count: { _all: true } }),
  ])

  const statusCounts: Record<string, number> = {}
  for (const group of grouped) statusCounts[group.status] = group._count._all

  return { rfqs, statusCounts, pagination: paginationResponse(total, page, limit) }
}

export async function listAssignableAdmins() {
  const users = await prisma.adminUser.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return { users }
}

export async function getRfq(id: string) {
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: rfqInclude,
  })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })
  return rfq
}

// ─── Mutations ────────────────────────────────────────────────

export async function updateRfqStatus(id: string, status: string, note: string | undefined, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })

  const updated = await prisma.rfq.update({
    where: { id },
    data: { status },
  })

  if (note) {
    await prisma.rfqNote.create({
      data: { rfqId: rfq.id, authorId: actor.id, note, isInternal: true },
    })
  }

  await logAudit({
    actor, action: 'rfq.status.update',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    previousValue: { status: rfq.status }, newValue: { status },
    ipAddress,
  })

  return updated
}

export async function assignRfq(id: string, assignedTo: string, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })

  const assignee = await prisma.adminUser.findUnique({ where: { id: assignedTo } })
  if (!assignee) throw Object.assign(new Error('Assignee not found'), { status: 400 })

  const updated = await prisma.rfq.update({
    where: { id },
    data: { assignedTo },
  })

  await logAudit({
    actor, action: 'rfq.assign',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    newValue: { assignedTo: assignee.name },
    ipAddress,
  })

  return updated
}

export async function addRfqNote(id: string, noteText: string, isInternal: boolean, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })

  const note = await prisma.rfqNote.create({
    data: { rfqId: rfq.id, authorId: actor.id, note: noteText, isInternal: isInternal ?? true },
    include: { author: { select: { id: true, name: true, email: true } } },
  })

  await logAudit({
    actor, action: 'rfq.note.add',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    ipAddress,
  })

  return note
}

export async function respondToRfq(id: string, message: string, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })

  // Update status to quote-sent if new/reviewing
  if (rfq.status === 'new' || rfq.status === 'reviewing') {
    await prisma.rfq.update({ where: { id: rfq.id }, data: { status: 'quote-sent' } })
  }

  // Add response as note
  await prisma.rfqNote.create({
    data: { rfqId: rfq.id, authorId: actor.id, note: `Response sent: ${message}`, isInternal: false },
  })

  // Send email (non-blocking)
  sendRfqResponse({
    to: rfq.email, customerName: rfq.fullName, rfqNumber: rfq.rfqNumber, message,
  }).catch(err => logger.error({ err }, 'RFQ response email failed'))

  await logAudit({
    actor, action: 'rfq.respond',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    ipAddress,
  })
}

export async function convertRfqToOffer(id: string, offeredPrice: number, message: string | undefined, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })
  if (['won', 'lost', 'closed'].includes(rfq.status)) {
    throw Object.assign(new Error('This RFQ is already closed'), { status: 409 })
  }

  // One conversion per RFQ: a double-click or a second admin must not create
  // duplicate offers for the same request. Further negotiation uses the
  // counter-offer action on the existing offer.
  const existingOffer = await prisma.offer.findFirst({
    where: { rfqId: rfq.id, status: { in: ['pending', 'countered', 'accepted', 'awaiting-payment', 'paid', 'converted-to-order'] } },
    select: { id: true, offerNumber: true },
  })
  if (existingOffer) {
    throw Object.assign(
      new Error(`RFQ already has offer ${existingOffer.offerNumber}`),
      { status: 409 },
    )
  }

  // Preserve product identity when the RFQ's part number matches a catalogue
  // SKU, so offers/orders created from it link back to the real product.
  const product = rfq.partNumber
    ? await prisma.product.findFirst({
        where: { sku: { equals: rfq.partNumber, mode: 'insensitive' } },
        select: { id: true },
      })
    : null
  const customer = await prisma.customer.findFirst({
    where: { email: { equals: rfq.email, mode: 'insensitive' } },
    select: { id: true },
  })

  const offer = await prisma.offer.create({
    data: {
      offerNumber: await generateOfferNumber(),
      productId: product?.id || null,
      rfqId: rfq.id,
      customerId: rfq.customerId || customer?.id || null,
      customerEmail: rfq.email,
      offeredPrice,
      quantity: rfq.quantity,
      message: message || `Converted from RFQ ${rfq.rfqNumber}`,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.rfq.update({ where: { id: rfq.id }, data: { status: 'quote-sent' } })

  await logAudit({
    actor, action: 'rfq.convert-to-offer',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    newValue: { offerId: offer.id, offerNumber: offer.offerNumber },
    ipAddress,
  })

  return offer
}

export async function convertRfqToOrder(id: string, unitPrice: number, actor: AuthUser, ipAddress = '') {
  const rfq = await prisma.rfq.findUnique({ where: { id } })
  if (!rfq) throw Object.assign(new Error('RFQ not found'), { status: 404 })

  const product = rfq.partNumber
    ? await prisma.product.findFirst({
        where: { sku: { equals: rfq.partNumber, mode: 'insensitive' } },
        select: { id: true, name: true, sku: true, regularPrice: true },
      })
    : null
  const customer = rfq.customerId
    ? await prisma.customer.findUnique({ where: { id: rfq.customerId }, select: { id: true } })
    : await prisma.customer.findFirst({
        where: { email: { equals: rfq.email, mode: 'insensitive' } },
        select: { id: true },
      })

  const quantity = Math.max(1, rfq.quantity)
  // Totals are always derived server-side from the negotiated unit price —
  // never from a client-supplied order total. Shipping/tax use the same
  // pricing helper as storefront checkout and accepted-offer checkout.
  const { subtotal, shippingCost, tax, total } = await computeOrderTotals(
    unitPrice * quantity,
    rfq.country,
  )

  // Claim the RFQ before creating anything so concurrent conversions cannot
  // both produce an order.
  const claimed = await prisma.rfq.updateMany({
    where: { id: rfq.id, status: { notIn: ['won', 'lost', 'closed'] } },
    data: { status: 'won' },
  })
  if (claimed.count === 0) {
    throw Object.assign(new Error('This RFQ has already been converted or closed'), { status: 409 })
  }

  let orderId: string | null = null
  try {
    const currency = await getStoreCurrency()
    const order = await prisma.order.create({
      data: {
        orderNumber: await generateOrderNumber(),
        customerId: customer?.id || null,
        status: 'pending',
        paymentMethod: 'bank-transfer',
        paymentStatus: 'pending',
        subtotal, shippingCost, tax, total,
        currency,
        originalListedPrice: product ? Number(product.regularPrice) : null,
        negotiatedPrice: unitPrice,
        shippingFullName: rfq.fullName,
        shippingEmail: rfq.email,
        shippingCity: rfq.deliveryLocation || '',
        shippingCountry: rfq.country || '',
        customerNotes: `Converted from RFQ ${rfq.rfqNumber}`,
      },
    })
    orderId = order.id

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product?.id || null,
        productName: product?.name || rfq.productDescription.slice(0, 500),
        productSku: product?.sku || rfq.partNumber || '',
        quantity,
        unitPrice,
        totalPrice: subtotal,
      },
    })
    await prisma.orderTimeline.create({
      data: {
        orderId: order.id,
        status: 'pending',
        note: `Converted from RFQ ${rfq.rfqNumber}`,
        createdBy: actor.id,
      },
    })
  } catch (error) {
    // Remove any half-created order, then release the claim so the RFQ can be
    // retried after a failed conversion.
    if (orderId) await prisma.order.delete({ where: { id: orderId } }).catch(() => {})
    await prisma.rfq.update({ where: { id: rfq.id }, data: { status: rfq.status } }).catch(() => {})
    throw error
  }

  const fullOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })

  await logAudit({
    actor, action: 'rfq.convert-to-order',
    entityType: 'rfq', entityId: rfq.id, entityName: rfq.rfqNumber,
    newValue: { orderId, orderNumber: fullOrder?.orderNumber },
    ipAddress,
  })

  return fullOrder
}
