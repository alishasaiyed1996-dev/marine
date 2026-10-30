import { Router } from 'express'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import { sendSuccess } from '../../middleware/response.js'
import * as rfqService from '../../services/rfqService.js'

const router = Router()

const rfqSchema = z.object({
  fullName: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  email: z.string().email().max(254),
  phone: z.string().max(30).optional(),
  country: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  productDescription: z.string().min(1).max(5000),
  partNumber: z.string().max(200).optional(),
  brand: z.string().max(200).optional(),
  quantity: z.number().int().min(1).max(10000).default(1),
  deliveryLocation: z.string().max(500).optional(),
  urgency: z.enum(['standard', 'urgent', 'emergency']).default('standard'),
  notes: z.string().max(2000).optional(),
  source: z.string().max(200).optional(),
  consent: z.boolean().refine(v => v === true, 'Consent is required'),
  // When the visitor gave consent. Recorded with the request so the agreement
  // has a timestamp, not just a boolean the client always sends as true.
  consentAt: z.string().datetime({ offset: true }).optional(),
  policyAccepted: z.literal(true),
  policyAcceptedAt: z.string().datetime({ offset: true }),
})

// ─── Submit RFQ ────────────────────────────────────────────────
router.post('/', validateBody(rfqSchema), asyncHandler(async (req, res) => {
  const rfq = await rfqService.createRfq(req.body)

  sendSuccess(res, {
    message: 'RFQ submitted successfully',
    rfqNumber: rfq.rfqNumber,
    id: rfq.id,
  }, 201)
}))

export default router
