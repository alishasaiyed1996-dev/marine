import type { OrderSummary, SkippedCartItem } from '../store/useStore'

/**
 * The order confirmation must survive a page refresh.
 *
 * Checkout state used to live in memory only: after the order was placed the
 * cart was cleared and `orderPlaced` reset, so refreshing the success page
 * bounced the customer back to the catalog with no order number, no totals,
 * and no skipped-item list. For a bank-transfer customer — who is waiting for
 * payment instructions — that is the difference between "the order is real"
 * and "something went wrong".
 */

const STORAGE_KEY = 'alka-order-confirmation'
/** A confirmation older than a day is stale and must not be shown again. */
const TTL_MS = 24 * 60 * 60 * 1000

export interface StoredOrderConfirmation {
  orderId: string
  orderSummary: OrderSummary | null
  orderSkippedItems: SkippedCartItem[]
  /** Guest checkout email, needed to track/cancel without an account. */
  guestEmail?: string
  savedAt: number
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function saveOrderConfirmation(data: Omit<StoredOrderConfirmation, 'savedAt'>): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  } catch {
    /* quota exceeded — the confirmation simply will not survive a refresh */
  }
}

export function loadOrderConfirmation(): StoredOrderConfirmation | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredOrderConfirmation
    if (!parsed || typeof parsed.orderId !== 'string' || !parsed.orderId) return null
    if (!parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS) {
      store.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearOrderConfirmation(): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// ─── Guest email hand-off to the tracking page ──────────────────
//
// The checkout used to navigate to `/track-order?id=…&email=…`. The email in
// the query string ends up in the browser history, the access log and the
// analytics page location. It is handed over through sessionStorage instead
// and read (and cleared) by the tracking page.

const TRACK_EMAIL_KEY = 'alka-track-order-email'

export function savePendingTrackEmail(email: string): void {
  const store = storage()
  if (!store || !email) return
  try {
    store.setItem(TRACK_EMAIL_KEY, email)
  } catch {
    /* ignore */
  }
}

/** Reads and clears the pending tracking email. */
export function readPendingTrackEmail(): string {
  const store = storage()
  if (!store) return ''
  try {
    const value = store.getItem(TRACK_EMAIL_KEY) || ''
    store.removeItem(TRACK_EMAIL_KEY)
    return value
  } catch {
    return ''
  }
}
