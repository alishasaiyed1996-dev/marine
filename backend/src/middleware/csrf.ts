import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

// ─── Double-Submit Cookie CSRF Protection ────────────────────
// For SPA + API architecture:
// 1. Client fetches a CSRF token via GET /api/csrf-token
// 2. Server sets a csrf-token cookie (readable by JS since not httpOnly)
// 3. Client sends the token value as X-CSRF-Token header on state-changing requests
// 4. Server compares cookie value with header value
//
// This works because same-origin JavaScript can read the cookie and set the header,
// but cross-origin requests cannot read cookies or set custom headers.

const _csrfSecret = process.env.CSRF_SECRET || process.env.JWT_SECRET
if (!_csrfSecret) {
  throw new Error('FATAL: CSRF_SECRET or JWT_SECRET environment variable is required.')
}
const CSRF_SECRET = _csrfSecret as string
const COOKIE_NAME = 'csrf-token'
const HEADER_NAME = 'x-csrf-token'
const TOKEN_EXPIRY_MS = 60 * 60 * 1000 // 1 hour

// ─── Generate CSRF Token ─────────────────────────────────────
function generateCsrfToken(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex')
  const timestamp = Date.now().toString(36)
  const signature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(`${randomBytes}:${timestamp}`)
    .digest('hex')
    .slice(0, 16)
  return `${randomBytes}.${timestamp}.${signature}`
}

// ─── Verify CSRF Token ───────────────────────────────────────
function verifyCsrfToken(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false

  const [randomBytes, timestamp, signature] = parts

  // Recompute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(`${randomBytes}:${timestamp}`)
    .digest('hex')
    .slice(0, 16)

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) return false
  let diff = 0
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
  }
  if (diff !== 0) return false

  // Check expiry
  const tokenTime = parseInt(timestamp, 36)
  if (Date.now() - tokenTime > TOKEN_EXPIRY_MS) return false

  return true
}

// ─── GET /api/csrf-token — Issue Token ───────────────────────
export function issueCsrfToken(req: Request, res: Response) {
  // Only allow GET requests to issue tokens
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = generateCsrfToken()

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TOKEN_EXPIRY_MS,
    path: '/',
  })

  res.json({ csrfToken: token })
}

// ─── CSRF Verification Middleware ────────────────────────────
// Apply to state-changing routes (POST, PUT, PATCH, DELETE) that accept cookies.
// Skip for routes using only Bearer token auth without cookies.
export function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  // Only enforce on state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next()
  }

  // Skip CSRF for webhook endpoints (they use PayPal signature verification, not cookies)
  // Use originalUrl because mounted sub-routers see relative paths in req.path
  if (req.originalUrl.startsWith('/api/webhooks/')) {
    return next()
  }

  // Skip CSRF for health check
  if (req.path === '/api/health') {
    return next()
  }

  // Skip CSRF for the CSRF token endpoint itself
  if (req.path === '/api/csrf-token') {
    return next()
  }

  // Skip CSRF for token-refresh endpoints. They are authenticated by the
  // httpOnly refresh cookie alone and are not state-changing in a way CSRF
  // could abuse (a forged refresh only re-issues a token for the victim's own
  // account). The SPA calls them without an X-CSRF-Token header.
  // NOTE: verifyCsrf is mounted at app level, so req.originalUrl carries the
  // full prefix — match BOTH the legacy /api and the /api/v1 paths.
  if (
    /^\/(?:api|api\/v1)\/admin\/auth\/refresh$/.test(req.originalUrl) ||
    /^\/(?:api|api\/v1)\/auth\/refresh$/.test(req.originalUrl)
  ) {
    return next()
  }

  const cookieToken = req.cookies?.[COOKIE_NAME]
  const headerToken = req.headers[HEADER_NAME] as string | undefined

  // A request that carries NO session cookie is not cookie-authenticated: it
  // is authenticated with a bearer token, which a cross-site form cannot
  // forge. There is nothing for CSRF to protect there.
  const sessionCookies = [
    'customerRefreshToken',
    'adminRefreshToken',
    'refreshToken',
  ] as const
  const hasSessionCookie = sessionCookies.some((name) => Boolean(req.cookies?.[name]))

  // Fail CLOSED for cookie-authenticated requests: a session cookie without a
  // matching CSRF token is a forged cross-site request. The old behaviour
  // skipped verification whenever the CSRF cookie was missing, which meant any
  // future cookie-authenticated POST would have been unprotected the moment a
  // user cleared their cookies.
  if (!cookieToken) {
    if (hasSessionCookie) {
      return res.status(403).json({ error: 'CSRF token missing. Include X-CSRF-Token header.' })
    }
    return next()
  }

  if (!headerToken) {
    return res.status(403).json({ error: 'CSRF token missing. Include X-CSRF-Token header.' })
  }

  // Constant-time comparison
  if (cookieToken.length !== headerToken.length) {
    return res.status(403).json({ error: 'CSRF token mismatch' })
  }

  let diff = 0
  for (let i = 0; i < cookieToken.length; i++) {
    diff |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i)
  }
  if (diff !== 0) {
    return res.status(403).json({ error: 'CSRF token mismatch' })
  }

  // Verify the token is valid (not forged)
  if (!verifyCsrfToken(cookieToken)) {
    return res.status(403).json({ error: 'CSRF token expired or invalid' })
  }

  next()
}
