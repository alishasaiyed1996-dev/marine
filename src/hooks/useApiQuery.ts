import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { api, storefront } from '../lib/api'
import { apiProductToFrontend } from '../lib/adapters'
import { products as staticProducts } from '../data/products'
import { industries as staticIndustries } from '../data/industries'
import type { ApiOrder, ApiProduct, Pagination, ProductListFilters } from '../lib/api-types'
import type { Industry, Product } from '../types'

// ─── Query Key Factory ─────────────────────────────────────────
// Stable, predictable query keys for cache invalidation.

const queryKeys = {
  products: {
    list: (params?: Record<string, string>) => ['products', 'list', params] as const,
    featured: () => ['products', 'featured'] as const,
    newArrivals: () => ['products', 'new-arrivals'] as const,
    detail: (id?: string) => ['products', 'detail', id] as const,
  },  categories: {
    all: ['categories'] as const,
  },
  brands: {
    all: ['brands'] as const,
  },
  industries: {
    all: ['industries'] as const,
  },
  orders: {
    // Scoped per user so a different account can never read the previous
    // customer's cached order history.
    mine: (userId?: string) => ['orders', 'mine', userId] as const,
  },
}

// ─── Product Queries ───────────────────────────────────────────

export function useProductList(params?: Record<string, string>) {
  return useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: () => api.get<{ products: ApiProduct[]; pagination: Pagination; filters?: ProductListFilters }>(
      `/storefront/products${params ? '?' + new URLSearchParams(params).toString() : ''}`
    ),
    // Keep the previous page/filter results visible while the next set loads
    placeholderData: keepPreviousData,
  })
}

export function useFeaturedProducts() {
  return useQuery({
    queryKey: queryKeys.products.featured(),
    queryFn: () => api.get<{ products: ApiProduct[] }>('/storefront/products/featured'),
    staleTime: 10 * 60 * 1000, // Featured products change rarely — cache 10 min
  })
}

export function useNewArrivals() {
  return useQuery({
    queryKey: queryKeys.products.newArrivals(),
    queryFn: () => api.get<{ products: ApiProduct[] }>('/storefront/products/new-arrivals'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Product detail with the same API→static fallback ProductDetail used before,
 * now as a cacheable query — so hover-prefetching (usePrefetchOnHover) makes
 * product pages open instantly, and revisits never re-fetch.
 */
export interface ProductDetailResult {
  product: Product | null
  related: Product[]
}

/** Stable cache key for a product detail page (slug when available, id otherwise). */
export function productDetailQueryKey(key?: string) {
  return queryKeys.products.detail(key)
}

/**
 * Fetch + adapt a product (and its related products) for the detail page.
 * Shared by `useProductDetail` and ProductCard's hover prefetch so the cache
 * always stores the frontend `Product` shape — never the raw API payload.
 */
export async function fetchProductDetail(id?: string): Promise<ProductDetailResult> {
  if (!id) return { product: null, related: [] }

  const toResult = (res: { product?: ApiProduct | null; related?: ApiProduct[] | null }) => ({
    product: res.product ? apiProductToFrontend(res.product) : null,
    related: (res.related || []).map(apiProductToFrontend).slice(0, 4),
  })

  // public/early-product.js starts this exact request while the JS bundle
  // is still downloading — roughly 1.5s before React hydrates. Reuse it
  // (one-shot) instead of paying a second API round trip after mount.
  const early = (window as unknown as {
    __EARLY_PRODUCT__?: { id: string; data: { product?: ApiProduct | null; related?: ApiProduct[] | null } }
  }).__EARLY_PRODUCT__
  if (early && early.id === id) {
    ;(window as unknown as { __EARLY_PRODUCT__?: unknown }).__EARLY_PRODUCT__ = undefined
    if (early.data.product) return toResult(early.data)
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
    const res = isUuid
      ? await storefront.products.get(id)
      : await api.get<{ product?: ApiProduct | null; related?: ApiProduct[] | null }>(`/storefront/products/by-slug/${encodeURIComponent(id)}`)
    if (res.product) {
      return toResult(res)
    }
  } catch {
    console.warn('[ProductDetail] API fetch failed — falling back to static product data')
  }
  const cleanId = id.toLowerCase().replace(/^prod-/, '')
  const staticProduct = staticProducts.find(
    (p) => p.id === id || p.id === `prod-${cleanId}` || p.id.replace('prod-', '') === cleanId,
  )
  return {
    product: staticProduct || null,
    related: staticProduct
      ? staticProducts
          .filter((p) => p.id !== staticProduct.id && p.category === staticProduct.category)
          .slice(0, 4)
      : [],
  }
}

export function useProductDetail(id?: string) {
  return useQuery({
    queryKey: productDetailQueryKey(id),
    queryFn: () => fetchProductDetail(id),
    enabled: Boolean(id),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

// ─── Category Queries ──────────────────────────────────────────

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => api.get<{ categories: any[] }>('/storefront/categories'),
    staleTime: 15 * 60 * 1000, // Categories rarely change
  })
}

// ─── Brand Queries ─────────────────────────────────────────────

export function useBrands() {
  return useQuery({
    queryKey: queryKeys.brands.all,
    queryFn: () => api.get<{ brands: any[] }>('/storefront/brands'),
    staleTime: 15 * 60 * 1000,
  })
}

/**
 * Fetch industries and adapt them to the frontend `Industry` shape, falling
 * back to static data. Shared by the query and the nav prefetch so both store
 * the same shape in the cache.
 */
async function fetchIndustries(): Promise<Industry[]> {
  try {
    const res = await storefront.industries.list()
    if (res.industries?.length) {
      return res.industries.map((i: any) => ({
        id: i.slug || i.id,
        name: i.name,
        icon: i.icon || 'Ship',
        description: i.description || '',
        painPoints: i.painPoints || [],
        productCount: i._count?.products ?? i.productCount ?? 0,
      }))
    }
  } catch {
    // Fall through to static data.
  }
  return staticIndustries
}

/**
 * Industries with API→static fallback. Shared by the Industries page and the
 * homepage IndustriesTabs section — one query key, one cache, no duplicate
 * fetches, and hover-prefetchable from the navbar.
 */
export function useIndustries() {
  return useQuery({
    queryKey: queryKeys.industries.all,
    queryFn: fetchIndustries,
    // Paint the static industries immediately while the query resolves, so
    // the section/page never shows a "Loading..." flash.
    placeholderData: staticIndustries,
    staleTime: 15 * 60 * 1000,
  })
}

/**
 * Warm the data for a top-level nav page on link hover, so navigating there
 * renders instantly. Keys must match the hooks' keys for cache sharing.
 */
export function prefetchNavData(path: string) {
  if (path === '/products' || path === '/shop') {
    // Must match Products' initial query exactly (it always sends limit/page).
    const params = { limit: '24', page: '1' }
    void queryClient.prefetchQuery({
      queryKey: queryKeys.products.list(params),
      queryFn: () => api.get(`/storefront/products?${new URLSearchParams(params).toString()}`),
      staleTime: 5 * 60 * 1000,
    })
  } else if (path === '/brands') {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.brands.all,
      queryFn: () => api.get<{ brands: any[] }>('/storefront/brands'),
      staleTime: 15 * 60 * 1000,
    })
  } else if (path === '/industries') {
    void queryClient.prefetchQuery({
      queryKey: queryKeys.industries.all,
      queryFn: fetchIndustries,
      staleTime: 15 * 60 * 1000,
    })
  }
}

/** Current customer's order history — cache for 30s so tracking refreshes feel live. */
export function useOrders(userId?: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: [...queryKeys.orders.mine(userId), page, limit],
    queryFn: async () => {
      const res = await storefront.orders.list({ page: String(page), limit: String(limit) })
      return {
        orders: (res.orders || []) as ApiOrder[],
        pagination: res.pagination,
      }
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
    // Keep the current page visible while the next page loads.
    placeholderData: keepPreviousData,
  })
}


