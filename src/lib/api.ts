/**
 * API client barrel — re-exports all public API surface.
 *
 * Every module imports from `../lib/api` (or `../../lib/api`), so
 * this barrel keeps existing imports working while the implementation
 * lives in smaller sub-modules under `api/`.
 */

export { api, ApiError } from './api/core'

// Token management
export {
  getAdminToken,
  getCustomerToken,
  setAdminToken,
  setCustomerToken,
  refreshAdminSession,
  refreshCustomerSession,
} from './api/core'

// Storefront endpoints (public)
export { storefront } from './api/storefront'

// Auth endpoints
export { customerAuth, adminAuth } from './api/auth'

// Admin endpoints (authenticated)
export { admin } from './api/admin'
