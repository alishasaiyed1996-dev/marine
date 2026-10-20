import { Response } from 'express'
import { toJsonSafe } from '../utils/json.js'

// ─── Standardized API Response Envelope ───────────────────────
// All API responses should use these helpers to ensure consistent
// response shapes across the entire backend.

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  details?: Array<{ field: string; message: string }>
  pagination?: Pagination
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

// ─── Success Response ──────────────────────────────────────────
// Spreads `ok: true` alongside the response data for backward compatibility.
// The API shape is: { ok: true, products: [...], pagination: {...} }
// NOT nested under `data` — this keeps existing frontend code working.
export function sendSuccess<T extends Record<string, unknown>>(
  res: Response,
  data: T,
  status = 200,
  pagination?: Pagination,
) {
  const body: Record<string, unknown> = { ok: true, ...data }
  if (pagination) body.pagination = pagination
  // Prisma Decimal → number at the HTTP boundary. The shared API contract
  // exposes money as numbers; see utils/json.ts for why this is necessary.
  return res.status(status).json(toJsonSafe(body))
}


// ─── Error Response ────────────────────────────────────────────
export function sendError(
  res: Response,
  error: string,
  status = 400,
  details?: Array<{ field: string; message: string }>,
) {
  const body: ApiResponse = { ok: false, error }
  if (details) body.details = details
  return res.status(status).json(body)
}

// ─── Pagination Helper ─────────────────────────────────────────
export function buildPagination(total: number, page: number, limit: number): Pagination {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  }
}
