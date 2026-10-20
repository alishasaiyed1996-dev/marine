import { prisma } from '../server.js'
import { paginationParams, paginationResponse } from '../utils/helpers.js'
import { orderInclude } from '../utils/prisma-helpers.js'

export interface OrderFilters {
  status?: string
  paymentStatus?: string
  search?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}

// ─── Queries (Admin) ──────────────────────────────────────────

export async function listOrders(params: OrderFilters) {
  const { page, limit, skip } = paginationParams(params.page, params.limit)

  const where: any = {}
  if (params.status) where.status = params.status
  if (params.paymentStatus) where.paymentStatus = params.paymentStatus
  if (params.search) {
    where.OR = [
      { orderNumber: { contains: params.search, mode: 'insensitive' } },
      { customer: { name: { contains: params.search, mode: 'insensitive' } } },
      { customer: { email: { contains: params.search, mode: 'insensitive' } } },
      { customer: { company: { contains: params.search, mode: 'insensitive' } } },
      { shippingFullName: { contains: params.search, mode: 'insensitive' } },
      { shippingEmail: { contains: params.search, mode: 'insensitive' } },
      { items: { some: { productSku: { contains: params.search, mode: 'insensitive' } } } },
    ]
  }
  // Date range (YYYY-MM-DD dates from the admin filters); `to` is inclusive of
  // the whole day.
  if (params.from || params.to) {
    where.createdAt = {}
    if (params.from) where.createdAt.gte = new Date(params.from)
    if (params.to) where.createdAt.lte = new Date(`${params.to}T23:59:59.999Z`)
  }

  // Per-status tallies for the admin filter tabs. Computed against the same
  // filters as the list but WITHOUT the status filter, so each tab shows its
  // true total under the current search/date constraints instead of only the
  // counts present on the current page.
  const statusWhere = { ...where }
  delete statusWhere.status

  const [orders, total, grouped] = await Promise.all([
    prisma.order.findMany({
      where, include: orderInclude,
      orderBy: { createdAt: 'desc' }, skip, take: limit,
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ['status'], where: statusWhere, _count: { _all: true } }),
  ])

  const statusCounts: Record<string, number> = {}
  for (const g of grouped) statusCounts[g.status] = g._count._all

  return { orders, statusCounts, pagination: paginationResponse(total, page, limit) }
}

export async function getOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  return order
}

// ─── Queries (Storefront — customer's own orders) ──────────────

export async function listCustomerOrders(customerId: string, page = 1, limit = 20, search?: string) {
  const skip = (page - 1) * limit
  const where: any = { customerId }

  // Track Order searches by order number. Filtering server-side means an
  // older order isn't missed just because it falls outside the first page.
  if (search) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { trackingNumber: { contains: search, mode: 'insensitive' } },
      ...(isUuid ? [{ id: search }] : []),
    ]
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip, take: limit,
    }),
    prisma.order.count({ where }),
  ])

  return {
    orders,
    pagination: {
      total, page, limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  }
}

export async function getCustomerOrder(id: string, customerId: string) {
  const order = await prisma.order.findFirst({
    where: { id, customerId },
    include: { items: true, timeline: { orderBy: { createdAt: 'desc' } } },
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  return order
}

/**
 * Guest (and signed-in) order lookup by order number/UUID + email. Requiring
 * the email used at checkout keeps order details private to the purchaser.
 */
export async function trackOrder(orderKey: string, email: string) {
  const key = orderKey.trim()
  const address = email.trim()
  if (!key || !address) {
    throw Object.assign(new Error('Order not found'), { status: 404 })
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  const order = await prisma.order.findFirst({
    where: {
      AND: [
        {
          OR: [
            { orderNumber: { equals: key, mode: 'insensitive' } },
            ...(isUuid ? [{ id: key }] : []),
          ],
        },
        {
          OR: [
            { shippingEmail: { equals: address, mode: 'insensitive' } },
            { customer: { email: { equals: address, mode: 'insensitive' } } },
          ],
        },
      ],
    },
    include: { items: true, timeline: { orderBy: { createdAt: 'desc' } } },
  })
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 })
  return order
}

// ─── Export ─────────────────────────────────────────────────

export async function exportOrdersCsv(): Promise<string> {
  const orders = await prisma.order.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' }, take: 10000 })
  const headers = ['Order Number', 'Status', 'Payment Status', 'Total', 'Created At']
  const rows = orders.map(o => [o.orderNumber, o.status, o.paymentStatus, o.total.toString(), o.createdAt.toISOString()])
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
}
