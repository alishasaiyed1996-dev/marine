import { Router } from 'express'
import { authenticateCustomer, AuthRequest } from '../../middleware/auth.js'
import { asyncHandler, validateBody } from '../../middleware/validate.js'
import { z } from 'zod'
import * as authService from '../../services/authService.js'
import { loginLimiter, registerLimiter, passwordResetLimiter } from '../../middleware/rateLimit.js'
import { sendSuccess, sendError } from '../../middleware/response.js'

const router = Router()

// Inline validation schemas (mirrors shared/validation.ts)
const registerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  company: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
})

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
})

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional(),
  company: z.string().max(200).optional(),
  country: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  website: z.string().max(200).optional(),
})

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(2000),
  password: z.string().min(8).max(128),
})

// ─── Register ──────────────────────────────────────────────────
router.post('/register', registerLimiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  try {
    const result = await authService.registerCustomer(req.body)
    res.cookie(authService.CUSTOMER_REFRESH_COOKIE, result.refreshToken, result.cookieOptions)
    sendSuccess(res, { accessToken: result.accessToken, user: result.user }, 201)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Login ─────────────────────────────────────────────────────
router.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  try {
    const result = await authService.loginCustomer(req.body.email, req.body.password)
    res.cookie(authService.CUSTOMER_REFRESH_COOKIE, result.refreshToken, result.cookieOptions)
    sendSuccess(res, { accessToken: result.accessToken, user: result.user })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Logout ────────────────────────────────────────────────────
router.post('/logout', authenticateCustomer, asyncHandler(async (_req, res) => {
  res.clearCookie(authService.CUSTOMER_REFRESH_COOKIE)
  res.clearCookie(authService.LEGACY_REFRESH_COOKIE)
  sendSuccess(res, { message: 'Logged out' })
}))

// ─── Get Current User ──────────────────────────────────────────
router.get('/me', authenticateCustomer, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await authService.getCustomerProfile(req.user!.id)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Update Profile ──────────────────────────────────────────
router.put('/me', authenticateCustomer, validateBody(updateProfileSchema), asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await authService.updateCustomerProfile(req.user!.id, req.body)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Refresh Token ────────────────────────────────────────────
router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    const token = req.cookies?.[authService.CUSTOMER_REFRESH_COOKIE]
      || req.cookies?.[authService.LEGACY_REFRESH_COOKIE]
    const result = await authService.refreshCustomerToken(token)
    res.cookie(authService.CUSTOMER_REFRESH_COOKIE, result.refreshToken, result.cookieOptions)
    sendSuccess(res, { accessToken: result.accessToken })
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Forgot Password ──────────────────────────────────────────
router.post('/forgot-password', passwordResetLimiter, validateBody(forgotPasswordSchema), asyncHandler(async (req, res) => {
  try {
    const result = await authService.forgotPassword(req.body.email)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

// ─── Reset Password ───────────────────────────────────────────
router.post('/reset-password', passwordResetLimiter, validateBody(resetPasswordSchema), asyncHandler(async (req, res) => {
  try {
    const result = await authService.resetPassword(req.body.token, req.body.password)
    sendSuccess(res, result)
  } catch (err: any) {
    sendError(res, err.message, err.status || 500)
  }
}))

export default router
