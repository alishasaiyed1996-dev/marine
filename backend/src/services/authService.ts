import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { SignOptions, JwtPayload } from 'jsonwebtoken'
import { prisma } from '../server.js'
import { logAudit } from '../utils/audit.js'
import { sendWelcome, sendPasswordReset } from './email.js'
import { notifyNewCustomer } from './adminNotifications.js'
import logger from '../utils/logger.js'
import { getFrontendUrl } from '../utils/env.js'
import type { AuthUser } from '../middleware/auth.js'

// JWT_SECRET availability is guaranteed by backend/src/utils/env.ts, which
// validates it at startup (refusing to boot in production without a real
// secret) before any module that reads it is loaded.
const JWT_SECRET = process.env.JWT_SECRET as string

// Separate refresh cookies so a customer session and an admin session in the
// same browser cannot overwrite each other. The old shared 'refreshToken'
// cookie is still read once for a smooth transition and cleared on logout.
export const CUSTOMER_REFRESH_COOKIE = 'customerRefreshToken'
export const ADMIN_REFRESH_COOKIE = 'adminRefreshToken'
export const LEGACY_REFRESH_COOKIE = 'refreshToken'

// ─── Token Generation ─────────────────────────────────────────

function generateAccessToken(payload: { id: string; email: string; role: string; type?: string }) {
  const options: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as unknown as SignOptions['expiresIn'] }
  return jwt.sign(payload, JWT_SECRET, options)
}

function generateCustomerAccessToken(payload: { id: string; email: string; role: string; type: string }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

function generateRefreshToken(payload: { id: string; email: string; role: string; type?: string }, expiresIn: string | undefined = undefined) {
  const expiry = expiresIn || process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
  const options: SignOptions = { expiresIn: expiry as unknown as SignOptions['expiresIn'] }
  return jwt.sign({ ...payload, refresh: true }, JWT_SECRET, options)
}

function generateCookieOptions(maxAgeDays: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  }
}

// ─── Customer Auth ─────────────────────────────────────────────

export async function registerCustomer(data: { name: string; email: string; password: string; phone?: string; company?: string; country?: string }) {
  const { password, ...fields } = data

  const existing = await prisma.customer.findUnique({ where: { email: data.email } })
  if (existing) throw Object.assign(new Error('Email already registered'), { status: 400 })

  const passwordHash = await bcrypt.hash(password, 12)
  const customer = await prisma.customer.create({ data: { ...fields, passwordHash } })

  const tokenPayload = { id: customer.id, email: customer.email, role: 'customer', type: 'customer' as const }
  const accessToken = generateCustomerAccessToken(tokenPayload)
  const refreshToken = generateRefreshToken(tokenPayload, '14d')

  const cookieOptions = generateCookieOptions(14)

  // Send welcome email (non-blocking)
  sendWelcome({ to: customer.email, name: customer.name, email: customer.email }).catch(err => {
    logger.error({ err }, 'Welcome email failed')
  })

  // Admin alert (off by default; only sent when the store enables it).
  notifyNewCustomer({
    name: customer.name, email: customer.email,
    company: data.company, country: data.country,
  }).catch(err => logger.error({ err }, 'Admin new-customer notification failed'))

  return {
    accessToken,
    refreshToken,
    cookieOptions,
    user: { id: customer.id, name: customer.name, email: customer.email },
  }
}

export async function loginCustomer(email: string, password: string) {
  const customer = await prisma.customer.findUnique({ where: { email } })
  if (!customer) throw Object.assign(new Error('Invalid email or password'), { status: 401 })

  const valid = await bcrypt.compare(password, customer.passwordHash)
  if (!valid) throw Object.assign(new Error('Invalid email or password'), { status: 401 })
  if (customer.status === 'inactive') {
    throw Object.assign(new Error('Account is deactivated'), { status: 403 })
  }

  await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } })

  const tokenPayload = { id: customer.id, email: customer.email, role: 'customer', type: 'customer' as const }
  const accessToken = generateCustomerAccessToken(tokenPayload)
  const refreshToken = generateRefreshToken(tokenPayload, '14d')

  return {
    accessToken,
    refreshToken,
    cookieOptions: generateCookieOptions(14),
    user: { id: customer.id, name: customer.name, email: customer.email },
  }
}

export async function getCustomerProfile(userId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, company: true, country: true },
  })
  if (!customer) throw Object.assign(new Error('User not found'), { status: 404 })
  return { user: customer }
}

export async function updateCustomerProfile(userId: string, data: any) {
  const customer = await prisma.customer.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, phone: true, company: true, country: true, city: true, address: true, website: true },
  })
  return { user: customer }
}

export async function refreshCustomerToken(refreshToken: string | undefined) {
  if (!refreshToken) throw Object.assign(new Error('No refresh token'), { status: 401 })

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload
    if (!decoded.refresh || decoded.type !== 'customer') {
      throw Object.assign(new Error('Invalid refresh token'), { status: 401 })
    }

    const customer = await prisma.customer.findUnique({ where: { id: decoded.id } })
    // `vip` and `new` are normal account states; only an explicit deactivation
    // blocks refreshing a session.
    if (!customer || customer.status === 'inactive') {
      throw Object.assign(new Error('Account not found or inactive'), { status: 401 })
    }

    const tokenPayload = { id: customer.id, email: customer.email, role: 'customer', type: 'customer' as const }
    const accessToken = generateCustomerAccessToken(tokenPayload)
    const newRefreshToken = generateRefreshToken(tokenPayload, '14d')

    return { accessToken, refreshToken: newRefreshToken, cookieOptions: generateCookieOptions(14) }
  } catch {
    logger.warn({ err: new Error('Invalid customer refresh token') }, 'Customer token refresh failed')
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 })
  }
}

export async function forgotPassword(email: string) {
  const customer = await prisma.customer.findUnique({ where: { email } })

  // Always return success to prevent email enumeration
  if (!customer) {
    return { message: 'If an account exists with this email, a reset link has been sent.' }
  }

  const resetToken = jwt.sign(
    { id: customer.id, email: customer.email, type: 'customer', reset: true },
    JWT_SECRET + customer.passwordHash,
    { expiresIn: '1h' }
  )

  const resetUrl = `${getFrontendUrl()}/reset-password?token=${resetToken}`

  sendPasswordReset({ to: customer.email, name: customer.name, resetUrl }).catch(err => {
    logger.error({ err }, 'Password reset email failed')
  })

  return { message: 'If an account exists with this email, a reset link has been sent.' }
}

export async function resetPassword(token: string, newPassword: string) {
  const decoded = jwt.decode(token) as JwtPayload | null
  if (!decoded || !decoded.id || !decoded.reset || decoded.type !== 'customer') {
    throw Object.assign(new Error('Invalid reset token'), { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: decoded.id } })
  if (!customer) {
    throw Object.assign(new Error('Invalid or expired reset token'), { status: 400 })
  }

  try {
    jwt.verify(token, JWT_SECRET + customer.passwordHash)
  } catch {
    logger.warn({ err: new Error('Invalid reset token') }, 'Password reset token verification failed')
    throw Object.assign(new Error('Invalid or expired reset token'), { status: 400 })
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.customer.update({
    where: { id: decoded.id as string },
    data: { passwordHash },
  })

  return { message: 'Password has been reset. You can now log in.' }
}

export async function logoutCustomer() {
  return { message: 'Logged out' }
}

// ─── Admin Auth ────────────────────────────────────────────────

export async function loginAdmin(email: string, password: string, ipAddress: string, userAgent: string | undefined) {
  const user = await prisma.adminUser.findUnique({ where: { email } })
  if (!user) throw Object.assign(new Error('Invalid email or password'), { status: 401 })
  if (!user.isActive) throw Object.assign(new Error('Account is deactivated'), { status: 403 })

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw Object.assign(new Error('Invalid email or password'), { status: 401 })

  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  const tokenPayload = { id: user.id, email: user.email, role: user.role }
  const accessToken = generateAccessToken(tokenPayload)
  const refreshToken = generateRefreshToken(tokenPayload)

  await logAudit({
    action: 'login',
    entityType: 'admin_user',
    entityId: user.id,
    entityName: user.email,
    ipAddress,
    userAgent,
  })

  return {
    accessToken,
    refreshToken,
    cookieOptions: generateCookieOptions(7),
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl },
  }
}

export async function refreshAdminToken(refreshToken: string | undefined) {
  if (!refreshToken) throw Object.assign(new Error('No refresh token'), { status: 401 })

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload
    if (!decoded.refresh) throw Object.assign(new Error('Invalid refresh token'), { status: 401 })
    // P0 defense in depth: a customer refresh token must never mint admin tokens.
    if (decoded.type === 'customer') throw Object.assign(new Error('Invalid refresh token'), { status: 401 })

    const user = await prisma.adminUser.findUnique({ where: { id: decoded.id } })
    if (!user || !user.isActive) throw Object.assign(new Error('User not found or deactivated'), { status: 401 })

    const tokenPayload = { id: user.id, email: user.email, role: user.role }
    const accessToken = generateAccessToken(tokenPayload)
    const newRefreshToken = generateRefreshToken(tokenPayload)

    return { accessToken, refreshToken: newRefreshToken, cookieOptions: generateCookieOptions(7) }
  } catch {
    logger.warn({ err: new Error('Invalid customer refresh token') }, 'Customer token refresh failed')
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 })
  }
}

export async function logoutAdmin(actor: AuthUser | undefined, ipAddress: string) {
  if (actor) {
    await logAudit({
      actor,
      action: 'logout',
      entityType: 'admin_user',
      entityId: actor.id,
      ipAddress,
    })
  }
  return { message: 'Logged out successfully' }
}

export async function getAdminProfile(userId: string) {
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, avatarUrl: true, lastLoginAt: true },
  })
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })
  return { user }
}
