import { Router } from 'express'
import { authenticateAdmin } from '../../middleware/auth.js'
import { asyncHandler, validateQuery } from '../../middleware/validate.js'
import { sendSuccess } from '../../middleware/response.js'
import { z } from 'zod'
import * as dashboardService from '../../services/dashboardService.js'

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const router = Router()
router.use(authenticateAdmin)

// ─── Dashboard Stats ───────────────────────────────────────────
router.get('/stats', asyncHandler(async (_req, res) => {
  sendSuccess(res, await dashboardService.getDashboardStats())
}))

// ─── Dashboard Alerts ──────────────────────────────────────────
router.get('/alerts', asyncHandler(async (_req, res) => {
  sendSuccess(res, await dashboardService.getDashboardAlerts())
}))

// ─── Recent Activity ───────────────────────────────────────────
router.get('/activity', validateQuery(activityQuerySchema), asyncHandler(async (req, res) => {
  sendSuccess(res, await dashboardService.getRecentActivity(Number(req.query.limit)))
}))

export default router
