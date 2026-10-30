/**
 * Admin (authenticated) API endpoints.
 *
 * Every call uses the core `api` convenience methods with
 * `auth: 'admin'` to inject the Bearer token automatically.
 */

import { API_BASE, api, apiFetch, ApiError, getAdminToken } from './core'
import type {
  ApiProduct, ApiCategory, ApiBrand, ApiIndustry,
  ApiOrder, ApiRfq, ApiOffer, ApiCustomer, ApiMessage,
  ApiMediaAsset, ApiAdminUser, ApiAuditLog,
  ApiStoreSettings, Pagination,
} from '../api-types'
import type { ApiDashboardStats } from '../api-types'

// Offer analytics (G46) — mirrors backend OfferAnalyticsResult
// (services/offerAdminService.ts → offerAnalytics.ts).
export interface OfferAnalytics {
  windowDays: number
  windowStart: string
  windowEnd: string
  snapshot: {
    total: number
    byStatus: Record<string, number>
    openCount: number
    decidedCount: number
    acceptedOrPaidCount: number
    rejectedCount: number
    acceptanceRate: number | null
    rejectionRate: number | null
    avgResponseHours: number | null
    totalNegotiatedValue: number
    negotiatedCount: number
  }
  daily: { date: string; count: number }[]
  topProducts: { key: string; label: string; count: number }[]
  topRequesters: { key: string; label: string; count: number }[]
  burstFlags: { email: string; count: number; windowHours: number; severity: 'watch' | 'high' }[]
}

// Shapes returned by the admin dashboard endpoints (see backend
// services/dashboardService.ts — kept in sync with the canonical DashboardStats).
export interface DashboardAlertsResponse {
  lowStockProducts: { id: string; name: string; sku: string; stockCount: number; lowStockThreshold: number }[]
  /** Total low-stock products; lowStockProducts is only the first 20. */
  lowStockCount: number
  overdueRfqs: { id: string; rfqNumber: string; fullName: string; urgency: string; createdAt: string }[]
  outOfStockCount: number
}

export interface DashboardActivityResponse {
  logs: ApiAuditLog[]
}

export interface ActiveEbayListing {
  itemId: string | null
  title: string | null
  sku: string | null
  quantity: number
  price: number | null
  currency: string | null
  originalPrice: number | null
  originalCurrency: string | null
  listingUrl: string | null
  imageUrl: string | null
  categoryId: string | null
  categoryName: string | null
  condition: string | null
  listingType: string | null
  marketplace: string
  startTime: string | null
  endTime: string | null
  watchCount: number | null
  linkedProduct: {
    id: string
    slug: string
    sku: string
    status: string
  } | null
}

export interface ActiveEbayListingsResponse {
  listings: ActiveEbayListing[]
  pagination: Pagination
  fetchedAt: string
}

export type EbayImportJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Backend `EbayImportJob` without the (large) discovered itemIds array. */
export interface EbayImportJob {
  id: string
  status: EbayImportJobStatus
  marketplace: string
  cursor: number
  total: number
  processed: number
  created: number
  linked: number
  skipped: number
  failed: number
  remaining: number
  lastError: string | null
  createdBy: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** One-shot photo re-mirror job state (see backend ebayImageBackfill). */
export interface EbayImageBackfillJob {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  marketplace: string
  total: number
  processed: number
  imagesAdded: number
  imagesRemoved: number
  productsChanged: number
  failures: number
  startedAt: string
  finishedAt: string | null
  lastError: string | null
  lastProcessedSku: string | null
}

// ── Listing previews (GraphQL Inventory Mapping API) ──────────
// startListingPreviewsCreation eBay task state + per-product preview rows.

export interface EbayListingPreviewTask {
  id: string
  ebayTaskId: string
  marketplace: string
  /** running | completed | completed_with_error | failed */
  status: string
  total: number
  created: number
  unprocessed: number
  unmapped: number
  invalid: number
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EbayListingPreviewRow {
  id: string
  productId: string
  /** suggested | applied */
  status: string
  /** ok | unprocessed | unmapped | invalid */
  outcome: string
  reason: string | null
  categoryId: string | null
  categoryName: string | null
  categoryLevel: number | null
  epid: string | null
  /** 25-char eBay diagnostics id carried on the preview (see docs). */
  mappingReferenceId: string | null
  suggestedTitle: string | null
  /** [{ name, aspectValues, values: [{ value, confidence }] }] */
  aspects: Array<{ name: string; aspectValues?: string[]; values?: Array<{ value: string; confidence: string }> }> | null
  updatedAt: string
  product: { sku: string; name: string }
}

/** One admin override + its effective value for a behaviour flag. */
export interface EbayRuntimeFlagState {
  override: boolean | null
  source: 'admin' | 'env'
  effective: boolean
  envDefault: boolean
}

/** Backend `AutosyncSweepSummary` — the last catalog sweep. */
export interface EbaySweepSummary {
  sweptAt: string
  marketplace: string
  durationMs: number
  walkComplete: boolean
  activeOnEbay: number
  eligibleItemIds: number
  skippedOtherMarketplace: number
  newlyListed: number
  importEnqueued: { jobId: string | null; added: number; merged: boolean } | null
  ended: number
  endedSkipped: number
  reactivated: number
  priceUpdates: number
  stockUpdates: number
  conditionUpdates: number
  conditionChecked: number
  imageSyncs: number
  contentSyncs: number
  error: string | null
}

export interface EbayHubOverview {
  connection: {
    configured: boolean
    environment: string
    siteId: string | null
    accountConfigComplete: boolean
    missingAccountConfig: string[]
  }
  flags: {
    fullMirror: EbayRuntimeFlagState
    autoPublish: EbayRuntimeFlagState
    categoryPinCount: number
  }
  listings: {
    mapped: number
    byStatus: Record<string, number>
    paused: number
    syncFailed: number
    endedButInStock: number
    quantityDrift: number
    mappedProductsWithoutImages: number
    draftProductsLiveOnEbay: number
  }
  catalog: { products: number; importedFromEbay: number }
  orders: { byStatus: Record<string, number>; failed: number; ignored: number }
  events: { byStatus: Record<string, number> }
  lastSweep: EbaySweepSummary | null
  lastImportJob: EbayImportJob | null
  lastImageBackfill: EbayImageBackfillJob | null
  schedules: {
    autosyncIntervalMs: number
    syncIntervalMs: number
    importBatchSize: number
    imageBackfillBatch: number
    imageBackfillTickMs: number
    mirrorDeepBudget: number
  }
  problems: {
    syncFailedListings: Array<{
      id: string; sku: string; marketplace: string; status: string
      lastError: string | null; updatedAt: string; product: { id: string; name: string } | null
    }>
    failedOrders: Array<{ ebayOrderId: string; status: string; lastError: string | null; updatedAt: string; orderNumber: string | null }>
    failedEvents: Array<{ eventId: string; topic: string; error: string | null; createdAt: string }>
  }
}

export interface EbayHubListingRow {
  id: string
  sku: string
  marketplace: string
  status: string
  syncDisabled: boolean
  ebayOfferId: string | null
  ebayListingId: string | null
  lastSyncedQty: number | null
  lastSyncAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  quantityDrift: boolean
  product: {
    id: string
    name: string
    slug: string
    status: string
    availability: string
    stockCount: number
    regularPrice: number | null
    salePrice: number | null
    currency: string
    imageCount: number
    updatedAt: string
  }
}

export interface EbayHubListingsResponse {
  listings: EbayHubListingRow[]
  pagination: Pagination
  statusCounts: Record<string, number>
  marketplaces: { marketplace: string; count: number }[]
}

export interface EbayHubUnimportedListingsResponse {
  listings: ActiveEbayListing[]
  totalActiveOnEbay: number
  scanned: number
  missingCount: number
  fetchedAt: string
}

export interface EbayHubOrderRow {
  id: string
  ebayOrderId: string
  status: string
  totalAmount: number | null
  currency: string | null
  lastError: string | null
  processedAt: string | null
  createdAt: string
  updatedAt: string
  order: {
    id: string; orderNumber: string; status: string
    total: number | null; currency: string; itemCount: number
  } | null
}

export interface EbayHubOrdersResponse {
  orders: EbayHubOrderRow[]
  pagination: Pagination
  statusCounts: Record<string, number>
}

export interface EbayHubEventRow {
  id: string
  eventId: string
  topic: string
  status: string
  error: string | null
  processedAt: string | null
  createdAt: string
  payloadPreview: string | null
}

export interface EbayHubEventsResponse {
  events: EbayHubEventRow[]
  pagination: Pagination
  statusCounts: Record<string, number>
}

export interface EbayHubCategoryPin {
  id: string
  slug: string
  source: 'admin' | 'env' | 'admin-overrides-env'
}

export interface EbayHubSettings {
  connection: {
    configured: boolean
    environment: string
    siteId: string | null
    marketplace: string
  }
  flags: { fullMirror: EbayRuntimeFlagState; autoPublish: EbayRuntimeFlagState }
  pins: EbayHubCategoryPin[]
  adminPinCount: number
  categories: { id: string; name: string; slug: string; parentId: string | null }[]
  limits: {
    importMaxImages: number
    mirrorDeepBudget: number
    autosyncIntervalMs: number
    imageBackfillBatch: number
    imageBackfillTickMs: number
    importBatchSize: number
  }
}

export interface EbayHubImportResult {
  outcome: 'created' | 'linked' | 'skipped' | 'failed'
  productId: string | null
}

export interface EbayEventRetryResult {
  status: 'processed' | 'duplicate' | 'ignored' | 'failed' | 'deferred'
  note?: string
}

export const admin = {
  // eBay marketplace sync (central inventory mirrors)
  ebay: {
    inventory: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ products: ApiProduct[]; pagination: Pagination }>(`/admin/ebay/inventory${qs}`, { auth: 'admin' })
    },
    activeListings: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<ActiveEbayListingsResponse>(`/admin/ebay/active-listings${qs}`, { auth: 'admin' })
    },
    syncNow: () => api.post<{ synced: number; failed: number; skipped: number; driftFound: number; ordersPolled: number }>('/admin/ebay/inventory/sync-now', undefined, { auth: 'admin' }),
    runCatalogAutosync: () =>
      api.post<{ summary: EbaySweepSummary }>('/admin/ebay/catalog-autosync/run', undefined, { auth: 'admin' }),
    createListing: (data: { productId: string; categoryId?: string; price?: number; marketplace?: string }) =>
      api.post<{ listing: { id: string; status: string; ebayOfferId?: string; ebayListingId?: string } }>('/admin/ebay/listings', data, { auth: 'admin' }),
    // ── Listing previews (GraphQL Inventory Mapping) ──
    runListingPreviews: (data?: { productIds?: string[]; marketplace?: string }) =>
      api.post<{ task: EbayListingPreviewTask }>('/admin/ebay/listing-previews/run', data ?? {}, { auth: 'admin' }),
    listingPreviewTasks: () =>
      api.get<{ tasks: EbayListingPreviewTask[] }>('/admin/ebay/listing-previews/tasks', { auth: 'admin' }),
    listingPreviewTask: (id: string) => {
      return api.get<{ task: EbayListingPreviewTask; previews: EbayListingPreviewRow[] }>(`/admin/ebay/listing-previews/tasks/${id}`, { auth: 'admin' })
    },
    startCatalogImport: (data?: { marketplace?: string }) =>
      api.post<{ job: EbayImportJob }>('/admin/ebay/catalog-import', data ?? {}, { auth: 'admin' }),
    catalogImport: (id: string) =>
      api.get<{ job: EbayImportJob }>(`/admin/ebay/catalog-import/${id}`, { auth: 'admin' }),
    latestCatalogImport: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ job: EbayImportJob | null }>(`/admin/ebay/catalog-import/latest${qs}`, { auth: 'admin' })
    },
    cancelCatalogImport: (id: string) =>
      api.post<{ job: EbayImportJob }>(`/admin/ebay/catalog-import/${id}/cancel`, undefined, { auth: 'admin' }),
    imageBackfill: () =>
      api.get<{ job: EbayImageBackfillJob | null }>('/admin/ebay/catalog-images-backfill', { auth: 'admin' }),
    startImageBackfill: (data?: { marketplace?: string }) =>
      api.post<{ job: EbayImageBackfillJob }>('/admin/ebay/catalog-images-backfill', data ?? {}, { auth: 'admin' }),
    cancelImageBackfill: () =>
      api.post<{ job: EbayImageBackfillJob | null }>('/admin/ebay/catalog-images-backfill/cancel', undefined, { auth: 'admin' }),

    // ── eBay Hub ──
    hubOverview: () => api.get<EbayHubOverview>('/admin/ebay/hub/overview', { auth: 'admin' }),
    hubListings: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<EbayHubListingsResponse>(`/admin/ebay/hub/listings${qs}`, { auth: 'admin' })
    },
    hubPauseListing: (id: string, disabled: boolean) =>
      api.post<{ listing: { id: string; sku: string; marketplace: string; syncDisabled: boolean } }>(
        `/admin/ebay/hub/listings/${id}/pause`, { disabled }, { auth: 'admin' }),
    hubPushQuantity: (id: string) =>
      api.post<{ result: { ok: boolean; message: string } }>(`/admin/ebay/hub/listings/${id}/push-quantity`, undefined, { auth: 'admin' }),
    hubResyncListing: (id: string) =>
      api.post<{
        result: {
          changed: boolean; contentUpdated: boolean; specsUpdated: boolean
          imagesAdded: number; imagesRemoved: number; conditionUpdated: boolean; productId: string
        }
      }>(`/admin/ebay/hub/listings/${id}/resync`, undefined, { auth: 'admin' }),
    hubReapplyCategory: (id: string) =>
      api.post<{
        result: {
          changed: boolean; keptCurrent: boolean; categoryId: string; slug: string
          previousSlug: string | null; confidence: string; reason: string
        }
      }>(`/admin/ebay/hub/listings/${id}/reapply-category`, undefined, { auth: 'admin' }),
    hubUnimportedListings: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<EbayHubUnimportedListingsResponse>(`/admin/ebay/hub/unimported-listings${qs}`, { auth: 'admin' })
    },
    hubImportListing: (itemId: string, marketplace = 'EBAY_US') =>
      api.post<EbayHubImportResult>(
        `/admin/ebay/hub/unimported-listings/${encodeURIComponent(itemId)}/import`,
        { marketplace },
        { auth: 'admin' },
      ),
    hubOrders: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<EbayHubOrdersResponse>(`/admin/ebay/hub/orders${qs}`, { auth: 'admin' })
    },
    hubRetryOrder: (ebayOrderId: string) =>
      api.post<{ result: EbayEventRetryResult }>(
        `/admin/ebay/hub/orders/${encodeURIComponent(ebayOrderId)}/retry`, undefined, { auth: 'admin' }),
    hubEvents: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<EbayHubEventsResponse>(`/admin/ebay/hub/events${qs}`, { auth: 'admin' })
    },
    hubRetryEvent: (eventId: string) =>
      api.post<{ result: EbayEventRetryResult }>(
        `/admin/ebay/hub/events/${encodeURIComponent(eventId)}/retry`, undefined, { auth: 'admin' }),
    hubSettings: () => api.get<EbayHubSettings>('/admin/ebay/hub/settings', { auth: 'admin' }),
    hubSaveSettings: (data: { fullMirror?: boolean | null; autoPublish?: boolean | null; categoryPins?: Record<string, string> }) =>
      api.put<{ settings: EbayHubSettings }>('/admin/ebay/hub/settings', data, { auth: 'admin' }),
  },

  // Dashboard
  dashboard: {
    stats: () => api.get<ApiDashboardStats>('/admin/dashboard/stats', { auth: 'admin' }),
    alerts: () => api.get<DashboardAlertsResponse>('/admin/dashboard/alerts', { auth: 'admin' }),
    activity: (limit?: number) =>
      api.get<DashboardActivityResponse>(`/admin/dashboard/activity${limit ? `?limit=${limit}` : ''}`, { auth: 'admin' }),
  },

  // Products
  products: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ products: ApiProduct[]; pagination: Pagination }>(`/admin/products${qs}`, { auth: 'admin' })
    },
    get: (id: string) =>
      api.get<{ product: ApiProduct }>(`/admin/products/${id}`, { auth: 'admin' }),
    create: (data: Partial<ApiProduct>) =>
      api.post<{ product: ApiProduct }>('/admin/products', data, { auth: 'admin' }),
    update: (id: string, data: Partial<ApiProduct>) =>
      api.put<{ product: ApiProduct }>(`/admin/products/${id}`, data, { auth: 'admin' }),
    delete: (id: string) =>
      api.del<{ message: string }>(`/admin/products/${id}`, { auth: 'admin' }),
    bulk: (ids: string[], action: string, value?: string) =>
      api.patch<{ updated: number }>('/admin/products/bulk', { ids, action, value }, { auth: 'admin' }),
    duplicate: (id: string) =>
      api.post<{ product: ApiProduct }>(`/admin/products/${id}/duplicate`, undefined, { auth: 'admin' }),
    importCsv: (rows: Record<string, string>[]) =>
      api.post<{ created: number; skipped: number; errors: string[] }>('/admin/products/import/csv', { rows }, { auth: 'admin' }),
    exportCsv: async () => {
      const res = await fetch(`${API_BASE}/admin/products/export/csv`, {
        headers: getAdminToken() ? { Authorization: `Bearer ${getAdminToken()}` } : undefined,
        credentials: 'include',
      })
      if (!res.ok) throw new ApiError(res.status, 'Export failed')
      return res.text()
    },
  },

  // Categories
  categories: {
    list: () => api.get<{ categories: ApiCategory[] }>('/admin/categories', { auth: 'admin' }),
    create: (data: Partial<ApiCategory>) => api.post<{ category: ApiCategory }>('/admin/categories', data, { auth: 'admin' }),
    update: (id: string, data: Partial<ApiCategory>) => api.put<{ category: ApiCategory }>(`/admin/categories/${id}`, data, { auth: 'admin' }),
    delete: (id: string) => api.del<{ message: string }>(`/admin/categories/${id}`, { auth: 'admin' }),
    reorder: (id: string, sortOrder: number) =>
      api.patch<{ category: ApiCategory }>(`/admin/categories/${id}/reorder`, { sortOrder }, { auth: 'admin' }),
  },

  // Brands
  brands: {
    list: () => api.get<{ brands: ApiBrand[] }>('/admin/brands', { auth: 'admin' }),
    create: (data: Partial<ApiBrand>) => api.post<{ brand: ApiBrand }>('/admin/brands', data, { auth: 'admin' }),
    update: (id: string, data: Partial<ApiBrand>) => api.put<{ brand: ApiBrand }>(`/admin/brands/${id}`, data, { auth: 'admin' }),
    delete: (id: string) => api.del<{ message: string }>(`/admin/brands/${id}`, { auth: 'admin' }),
  },

  // Industries
  industries: {
    list: () => api.get<{ industries: ApiIndustry[] }>('/admin/industries', { auth: 'admin' }),
    create: (data: Partial<ApiIndustry>) => api.post<{ industry: ApiIndustry }>('/admin/industries', data, { auth: 'admin' }),
    update: (id: string, data: Partial<ApiIndustry>) => api.put<{ industry: ApiIndustry }>(`/admin/industries/${id}`, data, { auth: 'admin' }),
    delete: (id: string) => api.del<{ message: string }>(`/admin/industries/${id}`, { auth: 'admin' }),
  },

  // Orders
  orders: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ orders: ApiOrder[]; statusCounts?: Record<string, number>; pagination: Pagination }>(`/admin/orders${qs}`, { auth: 'admin' })
    },
    get: (id: string) => api.get<{ order: ApiOrder }>(`/admin/orders/${id}`, { auth: 'admin' }),
    updateStatus: (id: string, status: string, note?: string) =>
      api.patch<{ order: ApiOrder }>(`/admin/orders/${id}/status`, { status, note }, { auth: 'admin' }),
    updateTracking: (id: string, trackingNumber: string, courier: string) =>
      api.patch<{ order: ApiOrder }>(`/admin/orders/${id}/tracking`, { trackingNumber, courier }, { auth: 'admin' }),
    cancel: (id: string, reason?: string) =>
      api.post<{ order: ApiOrder }>(`/admin/orders/${id}/cancel`, { reason }, { auth: 'admin' }),
    exportCsv: async () => {
      const res = await fetch(`${API_BASE}/admin/orders/export/csv`, {
        headers: getAdminToken() ? { Authorization: `Bearer ${getAdminToken()}` } : undefined,
        credentials: 'include',
      })
      if (!res.ok) throw new ApiError(res.status, 'Export failed')
      return res.text()
    },
  },

  // RFQs
  rfqs: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ rfqs: ApiRfq[]; statusCounts?: Record<string, number>; pagination: Pagination }>(`/admin/rfqs${qs}`, { auth: 'admin' })
    },
    assignees: () =>
      api.get<{ users: { id: string; name: string }[] }>('/admin/rfqs/assignees', { auth: 'admin' }),
    get: (id: string) => api.get<{ rfq: ApiRfq }>(`/admin/rfqs/${id}`, { auth: 'admin' }),
    updateStatus: (id: string, status: string) =>
      api.patch<{ rfq: ApiRfq }>(`/admin/rfqs/${id}/status`, { status }, { auth: 'admin' }),
    assign: (id: string, assignedTo: string) =>
      api.patch<{ rfq: ApiRfq }>(`/admin/rfqs/${id}/assign`, { assignedTo }, { auth: 'admin' }),
    addNote: (id: string, note: string, isInternal = true) =>
      api.post<{ note: { id: string; note: string; isInternal: boolean } }>(`/admin/rfqs/${id}/notes`, { note, isInternal }, { auth: 'admin' }),
    respond: (id: string, message: string) =>
      api.post<{ message: string }>(`/admin/rfqs/${id}/respond`, { message }, { auth: 'admin' }),
    convertToOffer: (id: string, offeredPrice: number, message?: string) =>
      api.post<{ offer: ApiOffer }>(`/admin/rfqs/${id}/convert-to-offer`, { offeredPrice, message }, { auth: 'admin' }),
    convertToOrder: (id: string, unitPrice: number) =>
      api.post<{ order: ApiOrder }>(`/admin/rfqs/${id}/convert-to-order`, { unitPrice }, { auth: 'admin' }),
  },

  // Offers
  offers: {
    analytics: (days = 30) =>
      api.get<{ analytics: OfferAnalytics }>(`/admin/offers/analytics?days=${days}`, { auth: 'admin' }),
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ offers: ApiOffer[]; pagination: Pagination; statusCounts?: Record<string, number> }>(`/admin/offers${qs}`, { auth: 'admin' })
    },
    get: (id: string) => api.get<{ offer: ApiOffer }>(`/admin/offers/${id}`, { auth: 'admin' }),
    accept: (id: string) => api.patch<{ offer: ApiOffer }>(`/admin/offers/${id}/accept`, undefined, { auth: 'admin' }),
    reject: (id: string) => api.patch<{ offer: ApiOffer }>(`/admin/offers/${id}/reject`, undefined, { auth: 'admin' }),
    counter: (id: string, counterPrice: number) =>
      api.patch<{ offer: ApiOffer }>(`/admin/offers/${id}/counter`, { counterPrice }, { auth: 'admin' }),
    convertToOrder: (id: string) =>
      api.post<{ order: ApiOrder }>(`/admin/offers/${id}/convert-to-order`, undefined, { auth: 'admin' }),
    exportCsv: async () => {
      const res = await fetch(`${API_BASE}/admin/offers/export/csv`, {
        headers: getAdminToken() ? { Authorization: `Bearer ${getAdminToken()}` } : undefined,
        credentials: 'include',
      })
      if (!res.ok) throw new ApiError(res.status, 'Export failed')
      return res.text()
    },
  },

  // Customers
  customers: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{
        customers: ApiCustomer[]
        statusCounts?: Record<string, number>
        stats?: { totalRevenue: number; avgLifetimeValue: number; vipCount: number; activeCount: number }
        pagination: Pagination
      }>(`/admin/customers${qs}`, { auth: 'admin' })
    },
    get: (id: string) => api.get<{ customer: ApiCustomer }>(`/admin/customers/${id}`, { auth: 'admin' }),
    create: (data: { name: string; email: string; password: string; phone?: string; company?: string; country?: string; city?: string }) =>
      api.post<{ customer: ApiCustomer }>('/admin/customers', data, { auth: 'admin' }),
    update: (id: string, data: Partial<ApiCustomer>) =>
      api.patch<{ customer: ApiCustomer }>(`/admin/customers/${id}`, data, { auth: 'admin' }),
    updateStatus: (id: string, status: string) =>
      api.patch<{ customer: ApiCustomer }>(`/admin/customers/${id}/status`, { status }, { auth: 'admin' }),
    addNote: (id: string, notes: string) =>
      api.post<{ customer: { id: string; internalNotes: string | null } }>(`/admin/customers/${id}/notes`, { notes }, { auth: 'admin' }),
  },

  // Messages
  messages: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{
        messages: ApiMessage[]
        counts?: { inbox: number; sent: number; trash: number; starred: number; unread: number }
        pagination: Pagination
      }>(`/admin/messages${qs}`, { auth: 'admin' })
    },
    get: (id: string) => api.get<{ message: ApiMessage }>(`/admin/messages/${id}`, { auth: 'admin' }),
    compose: (data: { to: string; subject: string; message: string }) =>
      api.post<{ message: string }>('/admin/messages', data, { auth: 'admin' }),
    reply: (id: string, message: string) =>
      api.post<{ message: string }>(`/admin/messages/${id}/reply`, { message }, { auth: 'admin' }),
    markRead: (id: string) => api.patch<{ message: ApiMessage }>(`/admin/messages/${id}/read`, undefined, { auth: 'admin' }),
    star: (id: string, starred: boolean) => api.patch<{ message: ApiMessage }>(`/admin/messages/${id}/star`, { starred }, { auth: 'admin' }),
    archive: (id: string) => api.patch<{ message: ApiMessage }>(`/admin/messages/${id}/archive`, undefined, { auth: 'admin' }),
    // Soft delete (moves to Trash)
    delete: (id: string) => api.del<{ message: string }>(`/admin/messages/${id}`, { auth: 'admin' }),
    restore: (id: string) => api.patch<{ message: ApiMessage }>(`/admin/messages/${id}/restore`, undefined, { auth: 'admin' }),
    // Permanent delete (only reachable from Trash)
    destroy: (id: string) => api.del<{ message: string }>(`/admin/messages/${id}/permanent`, { auth: 'admin' }),
  },

  // Media
  media: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ assets: ApiMediaAsset[]; labels?: string[]; totalSize?: number; pagination: Pagination }>(`/admin/media${qs}`, { auth: 'admin' })
    },
    usage: (id: string) => api.get<{ usage: { productId: string; productName: string; productSku: string }[] }>(`/admin/media/${id}/usage`, { auth: 'admin' }),
    delete: (id: string) => api.del<{ message: string }>(`/admin/media/${id}`, { auth: 'admin' }),
    upload: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return apiFetch<{ asset: ApiMediaAsset; message?: string }>('/admin/media/upload', {
        method: 'POST',
        body: formData,
        auth: 'admin',
      })
    },
  },

  // Settings
  settings: {
    get: () => api.get<{ settings: ApiStoreSettings; flat: { key: string; value: string; category: string }[] }>('/admin/settings', { auth: 'admin' }),
    update: (settings: ApiStoreSettings) =>
      api.put<{ message: string; count: number }>('/admin/settings', { settings }, { auth: 'admin' }),
  },

  // Users (owner only)
  users: {
    list: () => api.get<{ users: ApiAdminUser[] }>('/admin/users', { auth: 'admin' }),
    create: (data: { name: string; email: string; password: string; role: string; avatarUrl?: string }) =>
      api.post<{ user: ApiAdminUser }>('/admin/users', data, { auth: 'admin' }),
    update: (id: string, data: { name?: string; email?: string; avatarUrl?: string; isActive?: boolean }) =>
      api.put<{ user: ApiAdminUser }>(`/admin/users/${id}`, data, { auth: 'admin' }),
    deactivate: (id: string) => api.del<{ message: string }>(`/admin/users/${id}`, { auth: 'admin' }),
    changeRole: (id: string, role: string) =>
      api.patch<{ user: ApiAdminUser }>(`/admin/users/${id}/role`, { role }, { auth: 'admin' }),
  },

  // Audit
  audit: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ logs: ApiAuditLog[]; pagination: Pagination }>(`/admin/audit${qs}`, { auth: 'admin' })
    },
  },
}
