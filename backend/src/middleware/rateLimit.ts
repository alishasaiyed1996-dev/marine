import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit'
import crypto from 'crypto'

// ─── SSR Exemption for the Public Storefront Limiter ──────────
// server.js (the "marine" web service) renders every product and hub page
// server-side by calling this API. All of those fetches originate from ONE IP
// — the web service — so a Googlebot burst over ~1,100 distinct URLs crosses
// the public visitors' 100 req/min limit, the API answers 429, and the
// frontend turns that into a 503 + noindex outage shell. Google then slows
// crawling and drops the pages it had indexed. This is documented, with the
// reproduced measurements, in SEO_RANKING_RESEARCH.md §1.
//
// The frontend is one trusted internal client, so it is exempted with a
// shared secret: both services set SSR_API_TOKEN, the SSR fetch sends the
// header, and the limiter skips the request. The skip is scoped to read-only
// GET/HEAD so every state-changing storefront endpoint (RFQ, contact, auth,
// payments) stays rate-limited no matter what headers are presented.

export const SSR_TOKEN_HEADER = 'x-ssr-token'

/** Length-independent constant-time comparison. */
function secretsMatch(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * True when the request is a read-only fetch from the SSR frontend and
 * SSR_API_TOKEN is configured on this service. With the token unset this is
 * always false, so the limiter behaves exactly as before — the exemption is
 * opt-in through environment configuration.
 */
export function isSsrRequest(req: { method?: string; headers?: Record<string, unknown> }): boolean {
  const expected = String(process.env.SSR_API_TOKEN || '')
  if (!expected) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const presented = String(req.headers?.[SSR_TOKEN_HEADER] || '')
  return presented.length > 0 && secretsMatch(presented, expected)
}

// ─── Brute-Force Protection for Auth Endpoints ───────────────
// Stricter than general publicLimiter:
// - Login: 5 attempts per 15 minutes per IP
// - Register: 3 attempts per hour per IP
// - Password reset: 3 attempts per 15 minutes per IP
//
// These rely on express-rate-limit's default keyGenerator (req.ip), which
// honours `app.set('trust proxy', 1)`. Parsing X-Forwarded-For by hand would
// take the client-supplied left-most value and let an attacker rotate a fake IP
// per request to bypass the limit entirely.

export const loginLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                    // 5 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: true, // Don't count successful logins against limit
})

export const registerLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,                    // 3 registrations per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
})

export const passwordResetLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,                    // 3 reset requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again later.' },
})
