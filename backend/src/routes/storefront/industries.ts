import { Router } from 'express'
import { asyncHandler, validateParams } from '../../middleware/validate.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import { z } from 'zod'
import * as industryService from '../../services/industryService.js'

const router = Router()

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(200),
})

// ─── List Visible Industries ───────────────────────────────────
router.get('/', asyncHandler(async (_req, res) => {
  sendSuccess(res, await industryService.listStorefrontIndustries())
}))

// ─── Previous Industry Slug (301) ──────────────────────────────
router.get('/slug-history/:slug', validateParams(slugParamsSchema), asyncHandler(async (req, res) => {
  const old = await industryService.getIndustryByOldSlug(req.params.slug as string)
  if (!old) return sendError(res, 'Industry not found', 404)
  // The public site has no industry detail page yet; point old slugs at the
  // industries directory rather than inventing a route that does not exist.
  res.redirect(301, `/en/industries/#${encodeURIComponent(old.slug)}`)
}))

// ─── Get Industry by Slug ──────────────────────────────────────
router.get('/:slug', validateParams(slugParamsSchema), asyncHandler(async (req, res) => {
  try {
    sendSuccess(res, await industryService.getIndustryBySlug(req.params.slug as string))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
