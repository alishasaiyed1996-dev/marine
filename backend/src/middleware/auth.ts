import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { isSessionVersionCurrent } from '../utils/sessionVersion.js'

// JWT_SECRET availability is guaranteed by backend/src/utils/env.ts, which
// validates it at startup (refusing to boot in production without a real
// secret) before any module that reads it is loaded. The old module-load
// guard here was dead code and has been removed.
const JWT_SECRET = process.env.JWT_SECRET as string

export interface AuthUser {
  id: string
  email: string
  role: string
  type?: string
  /** The session version this token was issued with (see utils/sessionVersion). */
  tv?: number
}

export interface AuthRequest extends Request {
  user?: AuthUser
}

// ─── Authenticate Admin ────────────────────────────────────────

async function verifyAdminToken(
  token: string,
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let decoded: AuthUser & { refresh?: boolean }
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { refresh?: boolean }
  } catch {
    console.warn('[auth] Admin JWT verification failed')
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  // P0: a customer JWT must never gain admin access. Customer and admin
  // tokens share the same secret, so the role must be checked explicitly.
  if (decoded.type === 'customer') {
    console.warn('[auth] Customer JWT rejected on admin route')
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  // P0: a refresh token must never be usable as an access token. Refresh
  // tokens are long-lived (7 days for admins, 14 for customers) and are
  // accepted by the refresh endpoint only. Accepting one here would turn a
  // stolen refresh cookie into a full session.
  if (decoded.refresh === true) {
    console.warn('[auth] Refresh token rejected on admin route')
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }
  // The session version lets a logout, a password change or a deactivation
  // end every token that was already issued.
  if (!(await isSessionVersionCurrent('admin', decoded.id, decoded.tv))) {
    console.warn('[auth] Revoked admin session rejected')
    res.status(401).json({ error: 'Session has been revoked. Please sign in again.' })
    return
  }
  req.user = decoded
  next()
}
export function authenticateAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]
  return verifyAdminToken(token, req, res, next)
}

// ─── Authenticate Customer ─────────────────────────────────────
export function authenticateCustomer(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.split(' ')[1]
  return verifyCustomerToken(token, req, res, next)
}

async function verifyCustomerToken(
  token: string,
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let decoded: AuthUser & { type: string; refresh?: boolean }
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { type: string; refresh?: boolean }
  } catch {
    console.warn('[auth] Customer JWT verification failed')
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  if (decoded.type !== 'customer') {
    res.status(403).json({ error: 'Customer access required' })
    return
  }
  // A refresh token must never be usable as an access token.
  if (decoded.refresh === true) {
    console.warn('[auth] Refresh token rejected on customer route')
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }
  // A deactivated customer, or one who logged out everywhere, must not keep
  // browsing with an old token.
  if (!(await isSessionVersionCurrent('customer', decoded.id, decoded.tv))) {
    console.warn('[auth] Revoked customer session rejected')
    res.status(401).json({ error: 'Session has been revoked. Please sign in again.' })
    return
  }
  req.user = decoded
  next()
}

// ─── Optional Customer Auth (for guest checkout) ────────────
// Attempts to verify the customer JWT. If no token is present or it's
// invalid, req.user stays undefined — the route can proceed without auth.
// Optional does not mean unverified: a refresh token or a revoked session must
// never be treated as a signed-in customer just because the route also allows
// guests.
export async function optionalCustomerAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return next() // No token — proceed as guest
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { type: string; refresh?: boolean }
    if (
      decoded.type === 'customer'
      && decoded.refresh !== true
      && await isSessionVersionCurrent('customer', decoded.id, decoded.tv)
    ) {
      req.user = decoded
    }
  } catch {
    // Invalid, expired, or revoked token — proceed as guest. Never throw from
    // optional auth: the route explicitly supports guests.
  }
  next()
}

// ─── Require Role ──────────────────────────────────────────────
// requireRole() is a threshold check (userLevel >= requiredLevel), so two roles
// that share a level silently grant each other's permissions. `sales-agent`
// (customers/RFQs/offers) and `content-manager` (brand-logo) are independent
// domains and must not be equal, or each passes the other's routes.
const ROLE_HIERARCHY: Record<string, number> = {
  'owner': 6,
  'store-manager': 5,
  'inventory-manager': 4,
  'sales-agent': 3,
  'content-manager': 2,
  'viewer': 1,
}

export function requireRole(minRole: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0
    const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0

    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}

// ─── Require Owner ─────────────────────────────────────────────
export function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' })
  }
  next()
}

// ─── Read policy ───────────────────────────────────────────────

/**
 * Minimum role required to READ each admin resource.
 *
 * `viewer` is a read-only role, but "read-only" must not mean "read
 * everything". Customer names, emails, addresses, order values, RFQ contacts,
 * messages, and the store's payment configuration are personal or commercially
 * sensitive. A read-only account that can enumerate them is a data leak, not a
 * feature.
 *
 * The thresholds are deliberately independent of the mutation thresholds:
 * reading an order and cancelling an order are different privileges.
 */
export const ADMIN_READ_POLICY = {
  // Catalog and reporting — no personal data.
  products: 'viewer',
  categories: 'viewer',
  brands: 'viewer',
  industries: 'viewer',
  dashboard: 'viewer',
  // Customer personal data and order values.
  orders: 'sales-agent',
  rfqs: 'sales-agent',
  messages: 'sales-agent',
  offers: 'sales-agent',
  customers: 'sales-agent',
  // Commercially sensitive configuration (bank details, payment methods).
  settings: 'store-manager',
  audit: 'store-manager',
  // Account administration.
  users: 'owner',
  // Channel integrations.
  ebay: 'inventory-manager',
  media: 'content-manager',
} as const

export type AdminResource = keyof typeof ADMIN_READ_POLICY

/** True when the user's role is high enough to read the resource. */
export function canReadResource(role: string | undefined, resource: AdminResource): boolean {
  const required = ADMIN_READ_POLICY[resource] ?? 'viewer'
  const userLevel = ROLE_HIERARCHY[role ?? ''] ?? 0
  const requiredLevel = ROLE_HIERARCHY[required] ?? 0
  return userLevel >= requiredLevel
}

/**
 * Route guard for reading a resource. Unlike `requireRole`, this uses the
 * per-resource read policy so a `viewer` gets a 403 on PII routes instead of
 * silently reading customer records.
 */
export function requireReadAccess(resource: AdminResource) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }
    if (!canReadResource(req.user.role, resource)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

// ─── Generate JWT ──────────────────────────────────────────────
export function generateToken(user: { id: string; email: string; role: string; type?: string }): string {
  const payload = { id: user.id, email: user.email, role: user.role, type: user.type || 'admin' }
  const options: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as unknown as SignOptions['expiresIn'] }
  return jwt.sign(payload, JWT_SECRET, options)
}

export function generateRefreshToken(user: { id: string; email: string; role: string; type?: string }): string {
  const payload = { id: user.id, email: user.email, role: user.role, type: user.type || 'admin', refresh: true }
  const options: SignOptions = { expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as unknown as SignOptions['expiresIn'] }
  return jwt.sign(payload, JWT_SECRET, options)
}
