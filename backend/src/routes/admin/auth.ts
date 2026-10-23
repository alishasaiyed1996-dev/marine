import { Router } from 'express'
import { authenticateAdmin, AuthRequest } from '../../middleware/auth.js'
import { revokeSessions } from '../../utils/sessionVersion.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import * as authService from '../../services/authService.js'
import { sendSuccess, sendError } from '../../middleware/response.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// ─── Admin Login ───────────────────────────────────────────────
router.post('/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
  try {
    const result = await authService.loginAdmin(
      req.body.email, req.body.password, req.ip || '', req.headers['user-agent'] as string | undefined
    )
    res.cookie(authService.ADMIN_REFRESH_COOKIE, result.refreshToken, result.cookieOptions)
    sendSuccess(res, { accessToken: result.accessToken, user: result.user })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Refresh Token ─────────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const token = req.cookies?.[authService.ADMIN_REFRESH_COOKIE]
      || req.cookies?.[authService.LEGACY_REFRESH_COOKIE]
    const result = await authService.refreshAdminToken(token)
    res.cookie(authService.ADMIN_REFRESH_COOKIE, result.refreshToken, result.cookieOptions)
    sendSuccess(res, { accessToken: result.accessToken })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Logout ────────────────────────────────────────────────────
router.post('/logout', authenticateAdmin, asyncHandler(async (req: AuthRequest, res) => {
  res.clearCookie(authService.ADMIN_REFRESH_COOKIE)
  res.clearCookie(authService.LEGACY_REFRESH_COOKIE)
  await authService.logoutAdmin(req.user, req.ip || '')
  // Logging out must actually end the session: a stolen access token stayed
  // usable for its whole lifetime before this.
  await revokeSessions('admin', req.user!.id).catch(() => {})
  sendSuccess(res, { message: 'Logged out successfully' })
}))

// ─── Get Current User ──────────────────────────────────────────
router.get('/me', authenticateAdmin, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await authService.getAdminProfile(req.user!.id)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
