/**
 * JSON serialization helpers for API responses.
 *
 * Prisma money columns are `Decimal` instances. `JSON.stringify` calls
 * Decimal#toJSON, which returns a *string* (e.g. "149.99"), while the shared
 * frontend types—and every total/revenue calculation—expect numbers. Leaving
 * the strings in place made dashboard sums concatenate ("0100200") and
 * `.toLocaleString()` skip thousands separators.
 *
 * Convert Decimals to numbers only at the HTTP boundary; server-side pricing
 * continues to use Decimal arithmetic.
 */

import { Prisma } from '@prisma/client'

interface DecimalLike {
  toNumber: () => number
}

function isDecimal(value: object): value is DecimalLike {
  // Decimal.js minifies its constructor name in the Prisma runtime, so use the
  // library's own duck-type check instead of constructor.name.
  return Prisma.Decimal.isDecimal(value as Prisma.Decimal)
}

export function toJsonSafe(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  // Dates are serialized by JSON.stringify itself. Buffers never appear in our
  // API payloads, but preserving them avoids corrupting binary values.
  if (value instanceof Date || Buffer.isBuffer(value)) return value

  if (isDecimal(value)) return value.toNumber()

  if (Array.isArray(value)) return value.map(toJsonSafe)

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = toJsonSafe(child)
  }
  return result
}
