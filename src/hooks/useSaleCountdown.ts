import { useTickerNow } from './useTickerNow'

export interface Countdown {
  days: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
}

/**
 * Counts down to `endsAt` (ISO date string) using the app-wide shared ticker
 * (see TickerProvider) so every timed UI element — sale cards, RFQ response
 * banners — shares ONE interval instead of mounting its own `setInterval`.
 * Returns null when there is no end date, and `{ expired: true }` once the
 * target is reached.
 */
export function useCountdownTo(endsAt?: string | null): Countdown | null {
  const target = endsAt ? new Date(endsAt).getTime() : NaN
  const active = !Number.isNaN(target)
  // Only subscribe while there is an end date (inactive consumers never re-render).
  const now = useTickerNow(active)

  if (!active) return null

  const diff = target - now
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }

  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
    expired: false,
  }
}

/** Sale-specific alias, kept for backwards compatibility. */
export const useSaleCountdown = useCountdownTo
