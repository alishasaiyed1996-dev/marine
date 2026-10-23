import { Router } from 'express'
import { authenticateAdmin, requireRole, requireReadAccess, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import { sendSuccess, sendError } from '../../middleware/response.js'
import * as messageService from '../../services/messageService.js'

const router = Router()
router.use(authenticateAdmin)
// Contact messages contain the sender's name, email, and message body.
router.use(requireReadAccess('messages'))

const composeSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
})

const replySchema = z.object({
  message: z.string().min(1),
})

const starSchema = z.object({
  starred: z.boolean(),
})

// ─── List All Messages ────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  sendSuccess(res, await messageService.listMessages({
    status: req.query.status as string,
    search: req.query.search as string,
    folder: req.query.folder as string,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  }))
}))

// ─── Get Message Detail ───────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  try {
    sendSuccess(res, await messageService.getMessage(req.params.id as string))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Compose / Send Message ──────────────────────────────────
router.post('/', requireRole('store-manager'), validateBody(composeSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.composeMessage(req.body, req.user!, req.ip), 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Mark as Read ─────────────────────────────────────────────
router.patch('/:id/read', asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.markAsRead(req.params.id as string, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Star / Unstar Message ────────────────────────────────────
router.patch('/:id/star', validateBody(starSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.starMessage(req.params.id as string, req.body.starred, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Archive Message ──────────────────────────────────────────
router.patch('/:id/archive', asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.archiveMessage(req.params.id as string, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Delete Message (soft — moves to Trash) ───────────────────
router.delete('/:id', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.deleteMessage(req.params.id as string, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Restore Message from Trash ───────────────────────────────
router.patch('/:id/restore', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.restoreMessage(req.params.id as string, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Permanently Delete Message ───────────────────────────────
router.delete('/:id/permanent', requireRole('store-manager'), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.destroyMessage(req.params.id as string, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Reply to Message ────────────────────────────────────────
router.post('/:id/reply', requireRole('store-manager'), validateBody(replySchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendSuccess(res, await messageService.replyToMessage(req.params.id as string, req.body.message, req.user!, req.ip))
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
