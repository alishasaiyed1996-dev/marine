import { Router } from 'express'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import * as rfqService from '../../services/rfqService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'

const router = Router()
router.use(authenticateAdmin)

const statusSchema = z.object({
  status: z.enum(['new', 'reviewing', 'awaiting-supplier', 'quote-sent', 'customer-replied', 'won', 'lost', 'closed']),
  note: z.string().optional(),
})

const assignSchema = z.object({
  assignedTo: z.string().uuid(),
})

const notesSchema = z.object({
  note: z.string().min(1),
  isInternal: z.boolean().optional(),
})

const respondSchema = z.object({
  message: z.string().min(1),
})

const convertToOfferSchema = z.object({
  offeredPrice: z.number().min(0),
  message: z.string().optional(),
})

const convertToOrderSchema = z.object({
  // Deprecated: totals are derived server-side from unitPrice × quantity.
  // Still accepted so older clients don't break.
  total: z.number().min(0).optional(),
  unitPrice: z.number().min(0),
})

// ─── List All RFQs ──────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const result = await rfqService.listRfqs({
    status: req.query.status as string,
    urgency: req.query.urgency as string,
    assignedTo: req.query.assignedTo as string,
    search: req.query.search as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  })
  sendSuccess(res, result)
}))

// ─── List Assignable Admin Users ────────────────────────────
// Must be declared before '/:id' so it isn't captured as an RFQ id.
router.get('/assignees', requireRole('sales-agent'), asyncHandler(async (_req, res) => {
  sendSuccess(res, await rfqService.listAssignableAdmins())
}))

// ─── Get RFQ Detail ─────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  try {
    const rfq = await rfqService.getRfq(req.params.id as string)
    sendSuccess(res, { rfq })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Update RFQ Status ──────────────────────────────────────
router.patch('/:id/status', requireRole('sales-agent'), validateBody(statusSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const rfq = await rfqService.updateRfqStatus(
      req.params.id as string, req.body.status, req.body.note, req.user!, req.ip
    )
    sendSuccess(res, { rfq })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Assign RFQ ─────────────────────────────────────────────
router.patch('/:id/assign', requireRole('store-manager'), validateBody(assignSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const rfq = await rfqService.assignRfq(
      req.params.id as string, req.body.assignedTo, req.user!, req.ip
    )
    sendSuccess(res, { rfq })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Add Internal Note ──────────────────────────────────────
router.post('/:id/notes', requireRole('sales-agent'), validateBody(notesSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const note = await rfqService.addRfqNote(
      req.params.id as string, req.body.note, req.body.isInternal ?? true, req.user!, req.ip
    )
    sendSuccess(res, { note }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Send Response to Customer ──────────────────────────────
router.post('/:id/respond', requireRole('sales-agent'), validateBody(respondSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    await rfqService.respondToRfq(req.params.id as string, req.body.message, req.user!, req.ip)
    sendSuccess(res, { message: 'Response sent' })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Convert RFQ to Offer ──────────────────────────────────
router.post('/:id/convert-to-offer', requireRole('store-manager'), validateBody(convertToOfferSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const offer = await rfqService.convertRfqToOffer(
      req.params.id as string, req.body.offeredPrice, req.body.message, req.user!, req.ip
    )
    sendSuccess(res, { offer }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Convert RFQ to Order ────────────────────────────────────
router.post('/:id/convert-to-order', requireRole('store-manager'), validateBody(convertToOrderSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await rfqService.convertRfqToOrder(
      req.params.id as string, req.body.unitPrice, req.user!, req.ip
    )
    sendSuccess(res, { order }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
