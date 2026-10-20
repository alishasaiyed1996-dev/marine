import { Request, Response, NextFunction } from 'express'
import xss from 'xss'

// ─── XSS Sanitization Options ────────────────────────────────
// Strip all HTML tags. Allow only plain text.
const xssOptions = {
  whiteList: {},          // No HTML tags allowed
  stripIgnoreTag: true,   // Strip all non-whitelisted tags
  stripIgnoreTagBody: ['script', 'style'], // Remove script/style entirely
}

// ─── Deep Sanitize Object ────────────────────────────────────
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return xss(value, xssOptions).trim()
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(val)
    }
    return sanitized
  }
  return value
}

// ─── Sanitize Middleware ─────────────────────────────────────
// Recursively strips XSS from all string values in req.body.
// Place this BEFORE validateBody in your route chains.
//
// /admin routes are trusted (authenticated admin users) and their payloads
// are validated by zod, so rich-text/HTML fields must NOT be stripped there.
const ADMIN_PATH_PATTERN = /\/admin(\/|$)/

export function sanitize(req: Request, _res: Response, next: NextFunction) {
  if (ADMIN_PATH_PATTERN.test(req.path)) {
    return next()
  }
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body)
  }
  // Also sanitize query params (some routes use them for search). Express 5
  // exposes req.query through a getter that parses on every access, so
  // mutating the object returned here would be discarded. Define an own,
  // writable property — same technique as validateQuery.
  if (req.query && typeof req.query === 'object') {
    const sanitizedQuery: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(req.query)) {
      sanitizedQuery[key] = typeof value === 'string'
        ? xss(value, xssOptions).trim()
        : Array.isArray(value)
          ? value.map((v) => (typeof v === 'string' ? xss(v, xssOptions).trim() : v))
          : value
    }
    Object.defineProperty(req, 'query', {
      value: sanitizedQuery,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  next()
}
