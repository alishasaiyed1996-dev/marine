/**
 * Storefront (public) API endpoints.
 *
 * Every call goes through the core `api` convenience methods
 * defined in core.ts.
 */

import { api } from './core'
import type {
  ApiProduct, ApiBrand, ApiCategory, ApiIndustry,
  ApiOrder, ApiStoreSettings, ApiOffer,
  ApiSearchResult, Pagination, ProductListResponse,
} from '../api-types'

export const storefront = {
  // Products
  products: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<ProductListResponse>(`/storefront/products${qs}`)
    },
    featured: () =>
      api.get<{ products: ApiProduct[] }>('/storefront/products/featured'),
    newArrivals: () =>
      api.get<{ products: ApiProduct[] }>('/storefront/products/new-arrivals'),
    emergency: () =>
      api.get<{ products: ApiProduct[] }>('/storefront/products/emergency'),
    get: (id: string) =>
      api.get<{ product: ApiProduct; related: ApiProduct[] }>(`/storefront/products/${id}`),
    related: (id: string) =>
      api.get<{ products: ApiProduct[] }>(`/storefront/products/${id}/related`),
  },

  // Categories
  categories: {
    list: () =>
      api.get<{ categories: ApiCategory[] }>('/storefront/categories'),
    get: (slug: string) =>
      api.get<{ category: ApiCategory }>(`/storefront/categories/${slug}`),
  },

  // Brands
  brands: {
    list: () =>
      api.get<{ brands: ApiBrand[] }>('/storefront/brands'),
    get: (slug: string) =>
      api.get<{ brand: ApiBrand }>(`/storefront/brands/${slug}`),
  },

  // Industries
  industries: {
    list: () =>
      api.get<{ industries: ApiIndustry[] }>('/storefront/industries'),
    get: (slug: string) =>
      api.get<{ industry: ApiIndustry }>(`/storefront/industries/${slug}`),
  },

  // Search
  search: (q: string) =>
    api.get<{ results: ApiSearchResult[]; total: number; query: string }>(
      `/storefront/search?q=${encodeURIComponent(q)}`
    ),

  // Settings
  settings: () =>
    api.get<{ settings: ApiStoreSettings }>('/storefront/settings'),

  // RFQ
  rfq: {
    submit: (data: {
      fullName: string; company?: string; email: string; phone?: string
      country?: string; role?: string; productDescription: string
      partNumber?: string; brand?: string; quantity?: number
      deliveryLocation?: string; urgency?: string; notes?: string
      source?: string; consent: boolean
      /** When the visitor gave consent — recorded with the request. */
      consentAt?: string
    }) => api.post<{ message: string; rfqNumber: string; id: string }>('/storefront/rfq', data),
  },

  // Payments
  payments: {
    clientId: () => api.get<{ clientId: string; currency?: string }>('/storefront/payments/client-id'),
    createPaypalOrder: (data: { orderId: string }) =>
      api.post<{ paypalOrderId: string }>('/storefront/payments/create-order', data, { auth: 'customer' }),
    capturePaypalOrder: (data: { paypalOrderId: string; orderId: string }) =>
      api.post<{
        status: string
        orderId: string
        orderNumber?: string
        subtotal?: number
        shippingCost?: number
        tax?: number
        total?: number
        currency?: string
        shippingEmail?: string | null
      }>('/storefront/payments/capture-order', data, { auth: 'customer' }),
  },

  // Offers
  offers: {
    submit: (data: {
      productId: string; customerEmail: string; offeredPrice: number
      quantity?: number; message?: string
    }) => api.post<{ message: string; offerNumber: string; id: string }>('/storefront/offers', data),

    // Current customer's offers (Make an Offer → account page)
    mine: () =>
      api.get<{ offers: ApiOffer[] }>('/storefront/offers/mine', { auth: 'customer' }),

    // Create the server-priced payment order for an accepted offer. The client
    // sends only the offer id + shipping address — never amounts.
    pay: (id: string, shipping: {
      fullName: string; addressLine1: string; addressLine2?: string
      city: string; state?: string; postalCode?: string; country: string
    }, termsAccepted: boolean) => api.post<{ order: ApiOrder }>(`/storefront/offers/${id}/pay`, { shipping, termsAccepted }, { auth: 'customer' }),

    // Accept an admin counter offer (counter becomes the payable price).
    acceptCounter: (id: string) =>
      api.post<{ message: string }>(`/storefront/offers/${id}/accept-counter`, undefined, { auth: 'customer' }),
  },

  // Contact
  contact: {
    submit: (data: { name: string; email: string; subject?: string; message: string }) =>
      api.post<{ message: string; id: string }>('/storefront/contact', data),
    emergency: (data: {
      name: string; phone: string; partDescription: string; vesselName?: string
    }) => api.post<{ message: string; id: string; rfqNumber: string }>('/storefront/contact/emergency', data),
  },

  // Orders (customer auth required)
  orders: {
    create: (data: {
      items: { productId: string; quantity: number; price?: number }[]
      shipping: {
        fullName: string; email?: string; addressLine1: string; addressLine2?: string
        city: string; state?: string; postalCode?: string; country: string
        phone?: string; company?: string; taxId?: string
      }
      paymentMethod: string; customerNotes?: string; idempotencyKey?: string
      termsAccepted: boolean
      subtotal?: number; tax?: number; total?: number
    }) => api.post<{ order: ApiOrder }>('/storefront/orders', data, { auth: 'customer' }),

    get: (id: string) =>
      api.get<{ order: ApiOrder }>(`/storefront/orders/${id}`, { auth: 'customer' }),

    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return api.get<{ orders: ApiOrder[]; pagination: Pagination }>(`/storefront/orders${qs}`, { auth: 'customer' })
    },

    // Guests can cancel by supplying the checkout email; signed-in customers
    // are matched by their token instead.
    cancel: (id: string, reason?: string, email?: string) =>
      api.post<{ order: ApiOrder }>(`/storefront/orders/${id}/cancel`, { reason, email }, { auth: 'customer' }),

    // Public lookup: order number (or UUID) + checkout email.
    track: (orderNumber: string, email: string) =>
      api.post<{ order: ApiOrder }>('/storefront/orders/track', { orderNumber, email }),
  },
}
