import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { authenticateCustomer, optionalCustomerAuth, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody, validateParams } from '../../middleware/validate.js'
import { z } from 'zod'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as offerService from '../../services/offerService.js'

const router = Router()

const offerSchema = z.object({
  productId: z.string().uuid(),
  // Optional in the payload: signed-in customers get their account email
  // resolved server-side below; guests must provide one.
  customerEmail: z.string().email().optional(),
  offeredPrice: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  message: z.string().optional(),
})

// ─── Submission flood limiter (G47) ────────────────────────────
// Tighter than the global public limiter: offer creation is a write + email
// send. 8 per 10 min per IP absorbs a human fixing typos and stops scripted
// bursts between the app-level guard checks. Relaxed under Playwright so
// e2e suites are never throttled.
const submitOfferLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: process.env.PLAYWRIGHT_TEST ? 10000 : 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many offers submitted. Please try again later.' },
})

// ─── Submit Offer ──────────────────────────────────────────────
// Logged-in submissions attach the customer (offer becomes payable from
// their account); guests keep the existing email-lead behavior. The amount
// is input only — the server validates eligibility, authoritative values,
// and abuse budgets (G47).
router.post('/', submitOfferLimiter, optionalCustomerAuth, validateBody(offerSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const email = req.user?.email || req.body.customerEmail
    if (!email) {
      return sendError(res, 'Email is required', 400)
    }
    const offer = await offerService.submitOffer({
      ...req.body,
      customerEmail: email,
      // A signed-in customer's offer is always bound to their account —
      // the client-supplied email is used only for correspondence.
      customerId: req.user?.id ?? null,
      // trust proxy = 1 in server.ts → req.ip is the real client IP behind
      // the proxy. Best-effort only: undefined simply disables the IP breaker.
      submissionIp: req.ip,
    })
    sendSuccess(res, {
      message: 'Offer submitted successfully',
      offerNumber: offer.offerNumber,
      id: offer.id,
    }, 201)
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Failed to submit offer', e.status || 500)
  }
}))

// ─── My Offers (customer) ──────────────────────────────────────
// Declared before '/:id' so it is never captured as an offer id.
router.get('/mine', authenticateCustomer, asyncHandler(async (req: AuthRequest, res) => {
  const result = await offerService.listCustomerOffers(req.user!.id)
  sendSuccess(res, result)
}))

const idParamsSchema = z.object({ id: z.string().uuid() })

const paySchema = z.object({
  shipping: z.object({
    fullName: z.string().min(1),
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().min(1),
  }),
  termsAccepted: z.literal(true),
})

// ─── Create the payment order for an accepted offer ───────────
// Client sends ONLY the offer id + shipping address. Amount, currency,
// product price, shipping and tax are computed server-side from stored data.
router.post('/:id/pay', authenticateCustomer, validateParams(idParamsSchema), validateBody(paySchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const order = await offerService.createOfferOrder(
      req.params.id as string,
      req.user!.id,
      req.body.shipping,
      req.body.termsAccepted,
    )
    sendSuccess(res, { order }, 201)
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Unable to start offer payment', e.status || 500)
  }
}))

// ─── Accept an admin counter offer ─────────────────────────────
router.post('/:id/accept-counter', authenticateCustomer, validateParams(idParamsSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    await offerService.acceptCounter(req.params.id as string, req.user!.id)
    sendSuccess(res, { message: 'Counter offer accepted' })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Unable to accept counter offer', e.status || 400)
  }
}))

export default router
