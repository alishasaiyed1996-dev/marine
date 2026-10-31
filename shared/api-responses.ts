/**
 * Standard API response envelope types.
 *
 * These define the shape of every API response. src/lib/api-types.ts builds
 * on top of these — new response shapes should extend what's here instead of
 * hand-rolling another local pagination/paragraph type.
 */

// ─── Pagination ───────────────────────────────────────────────

export interface Pagination {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface ProductListResponse {
  products: unknown[]
  pagination: Pagination
  filters?: {
    categories: { id: string; name: string; count: number }[]
    brands: { id: string; name: string; count: number }[]
    priceRange: { min: number; max: number }
  }
}
