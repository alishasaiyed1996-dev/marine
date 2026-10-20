import { useCallback, useEffect, useRef } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'

/**
 * Prefetch a query when the user hovers an element, so the next page/route
 * renders instantly (data is already in the cache — no loading screen).
 *
 * Uses the app-wide singleton queryClient (no provider lookup), so it works
 * in isolated component tests too. Fires at most once per mounted element;
 * safe to attach to onMouseEnter of links, cards, or list rows.
 *
 * Usage:
 *   const prefetch = usePrefetchOnHover(['products', 'detail', product.id], () => storefront.products.get(product.id))
 *   <Link onMouseEnter={prefetch} to={`/product/${product.id}`}>…
 */
export function usePrefetchOnHover<TData>(queryKey: QueryKey, queryFn: () => Promise<TData>) {
  const firedRef = useRef(false)
  // Keep the latest fetcher without making the returned callback (and any
  // effect that depends on it) change on every render.
  const queryFnRef = useRef(queryFn)
  useEffect(() => {
    queryFnRef.current = queryFn
  }, [queryFn])

  return useCallback(() => {
    if (firedRef.current) return // One warm-up per hover target is enough.
    firedRef.current = true
    void queryClient.prefetchQuery({
      queryKey,
      queryFn: () => queryFnRef.current(),
      staleTime: 5 * 60 * 1000, // Keep the warmed data fresh for 5 minutes.
    })
  }, [queryKey])
}
