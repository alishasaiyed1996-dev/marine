import { Router } from 'express'
import { authenticateCustomer, optionalCustomerAuth, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody, validateParams } from '../../middleware/validate.js'
import { z } from 'zod'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as orderService from '../../services/orderService.js'

const router = Router()

const shippingSchema = z.object({
  fullName: z.string().min(1),
  // Required for guests (enforced in createOrder); optional for signed-in
  // customers, whose address comes from their Customer record.
  email: z.string().email().max(255).optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().min(1),
})

const orderParamsSchema = z.object({
  id: z.string().uuid(),
})

const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
  shipping: shippingSchema,
  paymentMethod: z.enum(['bank-transfer', 'paypal']),
  customerNotes: z.string().optional(),
  idempotencyKey: z.string().max(200).optional(),
})

const trackSchema = z.object({
  orderNumber: z.string().trim().min(1).max(100),
  email: z.string().email().max(255),
})

const cancelSchema = z.object({
  reason: z.string().max(1000).optional(),
  // Guest orders are verified against the email used at checkout.
  email: z.string().email().max(255).optional(),
})

// ─── Create Order from Checkout ────────────────────────────────
// Accepts both logged-in and guest checkouts. When no auth token is
// present, customerId is omitted and the order is stored as a guest order.
router.post('/', optionalCustomerAuth, validateBody(orderSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await orderService.createOrder({
      ...req.body,
      customerId: req.user?.id ?? null,
    })
    sendSuccess(res, { order }, 201)
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Failed to create order', e.status || 500)
  }
}))

// ─── Track Order (guest or signed-in) ──────────────────────────
// Order number/UUID + the checkout email. This lets guests who checked out
// without an account track their order without an authenticated endpoint.
router.post('/track', validateBody(trackSchema), asyncHandler(async (req, res) => {
  try {
    const order = await orderService.trackOrder(req.body.orderNumber, req.body.email)
    sendSuccess(res, { order })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Order not found', e.status || 404)
  }
}))

// ─── List Own Orders ──────────────────────────────────────────
router.get('/', authenticateCustomer, asyncHandler(async (req: AuthRequest, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined
  const result = await orderService.listCustomerOrders(req.user!.id, page, limit, search || undefined)
  sendSuccess(res, result)
}))

// ─── Get Order (own orders only) ───────────────────────────────
router.get('/:id', authenticateCustomer, validateParams(orderParamsSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await orderService.getCustomerOrder(req.params.id as string, req.user!.id)
    sendSuccess(res, { order })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Order not found', e.status || 404)
  }
}))

// ─── Request Cancellation ──────────────────────────────────────
// Signed-in customers cancel their own orders; guests must provide the email
// used at checkout. Both paths are ownership-checked in the service.
router.post(
  '/:id/cancel',
  optionalCustomerAuth,
  validateParams(orderParamsSchema),
  validateBody(cancelSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user && !req.body.email) {
      return sendError(res, 'Email is required to cancel a guest order', 400)
    }
    try {
      const order = await orderService.requestOrderCancellation(
        req.params.id as string,
        req.user?.id ?? null,
        req.body.reason,
        req.body.email,
      )
      sendSuccess(res, { order })
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number }
      sendError(res, e.message || 'Cancellation failed', e.status || 400)
    }
  })
)

export default router
