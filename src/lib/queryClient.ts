import { QueryClient } from '@tanstack/react-query'

/**
 * The app-wide QueryClient.
 *
 * Catalog data only changes when an admin edits it, so reads get a 5-minute
 * freshness window and stay cached for 10 after that — browsing back and
 * forth never re-fires the same request. A failed read retries twice
 * (transient hiccups are common on mobile), but focus refetching is off:
 * re-requesting the whole catalog on every tab switch buys nothing, while
 * refetch-on-reconnect stays on so a flaky connection heals itself.
 * Mutations never retry on their own — an auto-retried POST is how you end
 * up with duplicate orders.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
