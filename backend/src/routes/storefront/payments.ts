import { Router } from 'express'
import { optionalCustomerAuth, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from '../../utils/paypal.js'
import { getStoreCurrency } from '../../services/settingsService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as paypalService from '../../services/paypalService.js'

const router = Router()

// ─── Get PayPal Client ID (for frontend SDK) ─────────────────
router.get('/client-id', asyncHandler(async (_req, res) => {
  if (!PAYPAL_CLIENT_ID) {
    return sendError(res, 'PayPal not configured', 503)
  }
  // The SDK must load with the store's settlement currency. Loading USD and
  // then charging EUR makes PayPal reject the create-order call.
  const currency = await getStoreCurrency()
  sendSuccess(res, { clientId: PAYPAL_CLIENT_ID, currency })
}))

// ─── Create PayPal Order ─────────────────────────────────────
const createOrderSchema = z.object({
  orderId: z.string().uuid(),
})

router.post('/create-order', optionalCustomerAuth, validateBody(createOrderSchema), asyncHandler(async (req: AuthRequest, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return sendError(res, 'PayPal not configured', 503)
  }

  try {
    const result = await paypalService.createPaypalOrder(req.body.orderId, req.user?.id ?? null)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Capture PayPal Order ────────────────────────────────────
const captureSchema = z.object({
  paypalOrderId: z.string().min(1),
  orderId: z.string().uuid(),
})

router.post('/capture-order', optionalCustomerAuth, validateBody(captureSchema), asyncHandler(async (req: AuthRequest, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return sendError(res, 'PayPal not configured', 503)
  }

  try {
    const result = await paypalService.capturePaypalOrder(req.body.paypalOrderId, req.body.orderId, req.user?.id ?? null)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
