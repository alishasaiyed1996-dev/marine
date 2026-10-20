import type { Request } from 'express'
import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit'
import { createHash } from 'node:crypto'
import type { AuthRequest } from './auth.js'

// ─── Per-User Rate Limiter ─────────────────────────────────────
// Uses req.user?.id when available (authenticated requests),
// falls back to IP address for unauthenticated requests.
// This prevents one user from exhausting another user's quota
// behind a shared IP (e.g., corporate NAT).

export function createUserAwareLimiter(options: {
  windowMs: number
  max: number
  message?: string
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: options.message || 'Too many requests, please try again later.' },
    keyGenerator: (req: Request) => {
      const authReq = req as AuthRequest
      // Use user ID if authentication has already run.
      if (authReq.user?.id) {
        return `user:${authReq.user.id}`
      }
      // Admin/customer routers authenticate *inside* the router, after this
      // limiter, so req.user is not populated yet. Bucket by the bearer token
      // itself (hashed, never stored raw) to keep quotas per-session behind a
      // shared NAT. Invalid tokens still hit auth and are rejected there.
      const header = req.headers.authorization
      if (header?.startsWith('Bearer ')) {
        const fingerprint = createHash('sha256').update(header.slice(7)).digest('hex').slice(0, 32)
        return `token:${fingerprint}`
      }
      // IP-based key for unauthenticated requests — `req.ip` is trust-proxy aware
      // (see `app.set('trust proxy', 1)`), whereas the raw X-Forwarded-For header
      // is client-spoofable and would let a caller rotate buckets.
      return req.ip || req.socket.remoteAddress || 'unknown'
    },
  })
}
