import { Router } from 'express'
import { z } from 'zod'
import { authenticateAdmin, requireRole, requireReadAccess, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as settingsService from '../../services/settingsService.js'

const router = Router()
router.use(authenticateAdmin)
// Store settings include the bank account and payment-method configuration.
// A read-only role must not be able to read them.
router.use(requireReadAccess('settings'))

const updateSettingsSchema = z.object({
  settings: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).refine(obj => Object.keys(obj).length > 0, 'At least one setting is required'),
})

// ─── Get All Settings ──────────────────────────────────────────
router.get('/', asyncHandler(async (req: AuthRequest, res) => {
  sendSuccess(res, await settingsService.getAllSettings(req.user))
}))

// ─── Update Settings ───────────────────────────────────────────
router.put('/', requireRole('store-manager'), validateBody(updateSettingsSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await settingsService.updateSettings(req.body.settings, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
