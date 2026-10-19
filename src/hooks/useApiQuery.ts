import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { api, storefront } from '../lib/api'
import { apiProductToFrontend } from '../lib/adapters'
import { products as staticProducts } from '../data/products'
import { industries as staticIndustries } from '../data/industries'
import type { ApiOrder, ApiProduct, Pagination, ProductListFilters } from '../lib/api-types'
import type { Product } from '../types'

// ─── Query Key Factory ─────────────────────────────────────────
// Stable, predictable query keys for cache invalidation.

const queryKeys = {
  products: {
    list: (params?: Record<string, string>) => ['products', 'list', params] as const,
    featured: () => ['products', 'featured'] as const,
    newArrivals: () => ['products', 'new-arrivals'] as const,
    detail: (id?: string) => ['products', 'detail', id] as const,
  },
  categories: {
    all: ['categories'] as const,
  },
  brands: {
    all: ['brands'] as const,
  },
  industries: {
    all: ['industries'] as const,
  },
  orders: {
    mine: ['orders', 'mine'] as const,
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
export function useProductDetail(id?: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: async () => {
      if (!id) return { product: null as Product | null, related: [] as Product[] }

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
    },
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
 * Industries with API→static fallback. Shared by the Industries page and the
 * homepage IndustriesTabs section — one query key, one cache, no duplicate
 * fetches, and hover-prefetchable from the navbar.
 */
export function useIndustries() {
  return useQuery({
    queryKey: queryKeys.industries.all,
    queryFn: async () => {
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
    },
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
    void queryClient.prefetchQuery({
      queryKey: queryKeys.products.list(undefined),
      queryFn: () => api.get('/storefront/products'),
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
      queryFn: () => storefront.industries.list(),
      staleTime: 15 * 60 * 1000,
    })
  }
}

/** Current customer's order history — cache for 30s so tracking refreshes feel live. */
export function useOrders(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orders.mine,
    queryFn: async () => {
      const res = await storefront.orders.list()
      return (res.orders || []) as ApiOrder[]
    },
    enabled,
    staleTime: 30 * 1000,
  })
}


