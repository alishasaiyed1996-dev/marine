import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateQuery, validateParams } from '../../middleware/validate.js'
import * as mediaService from '../../services/mediaService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import logger from '../../utils/logger.js'

const router = Router()
router.use(authenticateAdmin)
// All media mutations (upload/delete) require at least inventory-manager.
router.use(requireRole('inventory-manager'))

// ─── Zod Schemas ───────────────────────────────────────────────
const listMediaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24).optional(),
  search: z.string().max(200).optional(),
  label: z.string().max(100).optional(),
  sort: z.enum(['date', 'name', 'label', 'size']).optional(),
})

const uuidParamSchema = z.object({
  id: z.string().uuid(),
})

// ─── Multer Config ────────────────────────────────────────────
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error(`Unsupported file type: ${file.mimetype}`))
  },
})

// ─── List Media Assets ─────────────────────────────────────────
router.get('/', validateQuery(listMediaQuerySchema), asyncHandler(async (req, res) => {
  const result = await mediaService.listMediaAssets({
    search: req.query.search as string,
    label: req.query.label as string | undefined,
    sort: req.query.sort as string | undefined,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  })
  sendSuccess(res, result)
}))

// ─── Get Media Usage ───────────────────────────────────────────
router.get('/:id/usage', validateParams(uuidParamSchema), asyncHandler(async (req, res) => {
  const result = await mediaService.getMediaUsage(req.params.id as string)
  sendSuccess(res, result)
}))

// ─── Multer Error Handler ────────────────────────────────────
// Catches MulterErrors (LIMIT_FILE_SIZE, wrong type) and returns
// a proper 400 response instead of a generic 500.
function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next()

  if (err instanceof multer.MulterError) {
    logger.warn({ multerError: err.code, field: err.field }, '[media] Multer upload error')
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return sendError(res, 'File too large. Maximum size is 20MB.', 400)
      case 'LIMIT_UNEXPECTED_FILE':
        return sendError(res, `Unexpected file field: ${err.field}`, 400)
      case 'LIMIT_FILE_COUNT':
        return sendError(res, 'Too many files uploaded at once.', 400)
      default:
        return sendError(res, `Upload error: ${err.message}`, 400)
    }
  }

  // Non-multer errors (e.g. from fileFilter rejecting the file)
  const error = err as Error
  logger.warn({ err: error }, '[media] Upload file rejected')
  return sendError(res, error.message || 'File rejected', 400)
}

// ─── Upload Media ─────────────────────────────────────────────
router.post('/upload',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) return handleMulterError(err, req, res, next)
      next()
    })
  },
  asyncHandler(async (req: AuthRequest, res) => {
    const startTime = Date.now()
    try {
      const result = await mediaService.uploadMedia(req.file!, req.user!)
      const elapsed = Date.now() - startTime
      logger.info({ duration: elapsed, filename: req.file?.originalname }, '[media] Upload successful')

      if (result.message) {
        return sendSuccess(res, result)
      }
      sendSuccess(res, result, 201)
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime
      const error = err as Error
      logger.error({ err: error, duration: elapsed, filename: req.file?.originalname }, '[media] Upload failed')
      const e = err as { message?: string; status?: number }
      sendError(res, e.message || 'Upload failed', e.status || 500)
    }
  })
)

// ─── Delete Media ──────────────────────────────────────────────
router.delete('/:id', validateParams(uuidParamSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await mediaService.deleteMedia(req.params.id as string)
    sendSuccess(res, result)
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Delete failed', e.status || 500)
  }
}))

export default router
