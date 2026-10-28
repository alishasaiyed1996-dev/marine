import { Router, Request, Response } from 'express'
import logger from '../../utils/logger.js'
import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from '../../utils/paypal.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as paypalService from '../../services/paypalService.js'

const router = Router()
const hookLog = logger.child({ context: 'paypal-webhook' })

// ─── PayPal Webhook Handler ──────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return sendError(res, 'PayPal not configured', 503)
  }

  // Verify webhook signature before processing
  const isValid = await paypalService.verifyPayPalWebhook({
    headers: req.headers as Record<string, string>,
    body: req.body,
  })
  if (!isValid) {
    hookLog.warn('PayPal webhook signature verification failed — rejecting webhook')
    return sendError(res, 'Invalid webhook signature', 401)
  }

  const event = req.body
  hookLog.info({ eventType: event.event_type }, 'PayPal webhook received and verified')

  // Log webhook
  await paypalService.logWebhookEvent(event.event_type, event)

  // Handle capture events
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    await paypalService.handleCaptureCompleted(event.resource)
  } else if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
    await paypalService.handleCaptureFailed(event.resource)
  } else if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    await paypalService.handleCaptureRefunded(event.resource)
  }

  sendSuccess(res, { received: true })
})

export default router
