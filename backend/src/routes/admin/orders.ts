import { Router } from 'express'
import { authenticateAdmin, requireRole, requireReadAccess, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import * as orderService from '../../services/orderService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'

const router = Router()
router.use(authenticateAdmin)
// Orders carry customer names, emails, addresses, and order values — a
// read-only `viewer` must not be able to enumerate them.
router.use(requireReadAccess('orders'))

const statusUpdateSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'paid', 'processing', 'packed', 'shipped', 'delivered', 'cancelled']),
  note: z.string().optional(),
})

const trackingSchema = z.object({
  trackingNumber: z.string().min(1),
  courier: z.string().min(1),
})

// ─── List All Orders ───────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const result = await orderService.listOrders({
    status: req.query.status as string,
    paymentStatus: req.query.paymentStatus as string,
    search: req.query.search as string,
    from: req.query.from as string,
    to: req.query.to as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  })
  sendSuccess(res, result)
}))

// ─── Get Order Detail ──────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  try {
    const order = await orderService.getOrder(req.params.id as string)
    sendSuccess(res, { order })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Update Order Status ───────────────────────────────────────
router.patch('/:id/status', requireRole('store-manager'), validateBody(statusUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const updated = await orderService.updateOrderStatus(
      req.params.id as string, req.body.status, req.body.note, req.user!, req.ip
    )
    sendSuccess(res, { order: updated })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Update Tracking ───────────────────────────────────────────
router.patch('/:id/tracking', requireRole('store-manager'), validateBody(trackingSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await orderService.updateTracking(
      req.params.id as string, req.body.trackingNumber, req.body.courier
    )
    sendSuccess(res, { order })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Cancel Order ──────────────────────────────────────────────
router.post('/:id/cancel', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await orderService.cancelOrder(req.params.id as string, req.body.reason, req.user!, req.ip)
    sendSuccess(res, { order })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Invoice PDF (simple HTML) ─────────────────────────────────
router.get('/:id/invoice', requireRole('store-manager'), asyncHandler(async (req, res) => {
  try {
    const html = await orderService.generateInvoiceHtml(req.params.id as string)
    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Export CSV ────────────────────────────────────────────────
router.get('/export/csv', requireRole('store-manager'), asyncHandler(async (_req, res) => {
  const csv = await orderService.exportOrdersCsv()
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv')
  res.send(csv)
}))

export default router
