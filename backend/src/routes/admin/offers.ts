import { Router } from 'express'
import { authenticateAdmin, requireRole, requireReadAccess, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as offerAdminService from '../../services/offerAdminService.js'

const router = Router()
router.use(authenticateAdmin)
// Offers carry the customer's email, name, and negotiated pricing.
router.use(requireReadAccess('offers'))

const counterSchema = z.object({ counterPrice: z.number().positive() })

// ─── List All Offers ───────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  sendSuccess(res, await offerAdminService.listOffers({
    status: req.query.status as string,
    productId: req.query.productId as string,
    search: req.query.search as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  }))
}))

// ─── Analytics (G46) ─────────────────────────────────────────
// Declared before '/:id' so it isn't captured as an offer id.
router.get('/analytics', requireRole('sales-agent'), asyncHandler(async (req, res) => {
  const days = Number(req.query.days) || 30
  sendSuccess(res, { analytics: await offerAdminService.getOfferAnalytics(days) })
}))

// ─── Export Offers CSV ───────────────────────────────────────
// Declared before '/:id' so it isn't captured as an offer id.
router.get('/export/csv', requireRole('sales-agent'), asyncHandler(async (_req, res) => {
  const csv = await offerAdminService.exportOffersCsv()
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename=offers-${new Date().toISOString().slice(0, 10)}.csv`)
  res.send(csv)
}))

// ─── Get Offer Detail ──────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  try {
    sendSuccess(res, await offerAdminService.getOffer(req.params.id as string))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Accept Offer ──────────────────────────────────────────────
router.patch('/:id/accept', requireRole('sales-agent'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await offerAdminService.acceptOffer(req.params.id as string, req.user!))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Reject Offer ──────────────────────────────────────────────
router.patch('/:id/reject', requireRole('sales-agent'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await offerAdminService.rejectOffer(req.params.id as string, req.user!))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Counter Offer ─────────────────────────────────────────────
router.patch('/:id/counter', requireRole('sales-agent'), validateBody(counterSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await offerAdminService.counterOffer(req.params.id as string, req.body.counterPrice, req.user!))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Convert Offer to Order ──────────────────────────────────
router.post('/:id/convert-to-order', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await offerAdminService.convertOfferToOrder(req.params.id as string, req.user!), 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
