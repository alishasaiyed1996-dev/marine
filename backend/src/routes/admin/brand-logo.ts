import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { authenticateAdmin, requireRole, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler } from '../../middleware/validate.js'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as brandLogoService from '../../services/brandLogoService.js'
import logger from '../../utils/logger.js'

const router = Router()
router.use(authenticateAdmin)
// Brand logo uploads are content — require at least content-manager.
router.use(requireRole('content-manager'))

// ─── Multer Config ────────────────────────────────────────────
// Brand logos are uploaded to Cloudinary by brandLogoService, but we still
// use multer memory storage to receive the file in the request.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for logos
  fileFilter: (_req, file, cb) => {
    // S4: SVG is intentionally NOT accepted. An uploaded SVG can carry
    // <script> that executes for every viewer of the asset URL (stored XSS);
    // the pipeline re-encodes to webp anyway, so there is no legitimate SVG
    // input left. The mimetype check below is the only gate — keep this list
    // in sync with it.
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error(`Unsupported file type: ${file.mimetype}`))
  },
})

// ─── Multer Error Handler ──────────────────────────────────
// Without this, multer errors (file too large, bad type) bubble to the global
// error handler and surface as 500s instead of a clear 400.
function handleMulterError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next()

  if (err instanceof multer.MulterError) {
    logger.warn({ multerError: err.code, field: err.field }, '[brand-logo] Multer upload error')
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return sendError(res, 'Logo too large. Maximum size is 5MB.', 400)
      case 'LIMIT_UNEXPECTED_FILE':
        return sendError(res, `Unexpected file field: ${err.field}`, 400)
      default:
        return sendError(res, `Upload error: ${err.message}`, 400)
    }
  }

  const error = err as Error
  logger.warn({ err: error }, '[brand-logo] Logo rejected')
  return sendError(res, error.message || 'File rejected', 400)
}

// ─── Upload Brand Logo ─────────────────────────────────────
router.post('/:id/logo', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) return handleMulterError(err, req, res, next)
    next()
  })
}, asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) {
    return sendError(res, 'No file uploaded. Use the "file" field with an image.', 400)
  }
  try {
    const result = await brandLogoService.uploadBrandLogo(
      req.params.id as string,
      req.file,
      req.user!,
      req.ip
    )
    sendSuccess(res, result)
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    sendError(res, e.message || 'Logo upload failed', e.status || 500)
  }
}))

export default router
